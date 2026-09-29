import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import skills
from sources import Sources, scan
from controller import Controller


class LocalGateway:
    def __init__(self, root):
        self.managers = {name: skills.Manager(root / name) for name in ['first', 'second']}
        self.fail = set()

    def nodes(self):
        return [{'id': name, 'name': name} for name in self.managers]

    def workspaces(self, target):
        if target['id'] in self.fail:
            raise RuntimeError('offline')
        return [{'workspaceId': 'environment', 'name': '环境运维', 'cwd': '/tmp/test'}]

    def run(self, target, workspace, argv, progress):
        manager = self.managers[target['id']]
        args = skills.parser().parse_args(argv)
        result = manager.inventory() if args.command == 'inventory' else manager.apply(args)
        return {'exit_code': 2 if result.get('conflicts') else 0, 'result': result}


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'upstream'
        self.repo.mkdir()
        self.git('init', '--quiet')
        self.git('config', 'user.name', 'Test')
        self.git('config', 'user.email', 'test@example.invalid')
        self.skill(self.repo / 'skills', 'review', 'first')
        self.initial = self.commit()
        self.base = self.root / 'data'
        shutil.copytree(self.repo / 'skills', self.base / 'common')
        records = {n: {**r, 'source': 'upstream', 'revision': self.initial}
                   for n, r in scan(self.base / 'common').items()}
        self.config = {'version': 2,
                       'sources': [{'id': 'upstream', 'type': 'git', 'url': str(self.repo),
                                    'ref': self.git('branch', '--show-current'), 'path': 'skills', 'skills': '*'}],
                       'snapshot': {'directory': 'common', 'prepared_at': 'initial', 'skills': records}}
        skills.write_json(self.base / 'source.json', self.config)
        self.source = Sources(self.base)
        self.gateway = LocalGateway(self.root / 'homes')
        self.controller = Controller(self.root, self.base, self.gateway)

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.repo, check=True, capture_output=True, text=True).stdout.strip()

    def commit(self):
        self.git('add', '.')
        self.git('commit', '--quiet', '-m', 'test')
        return self.git('rev-parse', 'HEAD')

    def skill(self, root, name, body):
        directory = root / name
        directory.mkdir(parents=True, exist_ok=True)
        (directory / 'SKILL.md').write_text('---\nname: ' + name + '\ndescription: test\n---\n' + body)
        return directory

    def test_check_is_read_only_and_apply_uses_reviewed_commit(self):
        old = (self.base / 'source.json').read_bytes()
        self.skill(self.repo / 'skills', 'review', 'second')
        reviewed = self.commit()
        candidate = self.source.check()
        self.assertEqual(candidate['changes'][0]['kind'], 'modified')
        self.assertEqual((self.base / 'source.json').read_bytes(), old)
        self.skill(self.repo / 'skills', 'new-after-preview', 'later')
        self.commit()
        result = self.controller.execute('apply-update', {'preview': candidate})
        self.assertEqual(result['source']['revision'], candidate['revision'])
        self.assertEqual(self.source.current()[0]['snapshot']['skills']['review']['revision'], reviewed)
        self.assertNotIn('new-after-preview', self.source.current()[0]['snapshot']['skills'])
        self.assertTrue((self.base / 'common/review/SKILL.md').read_text().endswith('first'))

    def test_upstream_removal_is_reported_and_applied(self):
        shutil.rmtree(self.repo / 'skills/review')
        self.skill(self.repo / 'skills', 'new', 'new')
        self.commit()
        candidate = self.source.check()
        self.assertEqual({c['name']: c['kind'] for c in candidate['changes']}, {'new': 'added', 'review': 'removed'})
        self.source.apply(candidate)
        self.assertEqual(set(self.source.current()[0]['snapshot']['skills']), {'new'})

    def test_legacy_config_is_rejected(self):
        skills.write_json(self.base / 'source.json', {'version': 1, 'repository': str(self.repo)})
        with self.assertRaisesRegex(ValueError, 'version 2'):
            self.source.check()

    def test_source_changes_after_review_block_apply(self):
        preview = self.source.check()
        self.config['sources'][0]['ref'] = 'another'
        skills.write_json(self.base / 'source.json', self.config)
        with self.assertRaisesRegex(ValueError, '变化'):
            self.source.apply(preview)

    def test_unregistered_snapshot_edit_blocks_update(self):
        self.skill(self.base / 'common', 'review', 'local edit')
        with self.assertRaisesRegex(ValueError, '未登记修改'):
            self.source.check()

    def test_failed_pointer_update_preserves_old_snapshot(self):
        self.skill(self.repo / 'skills', 'review', 'second')
        self.commit()
        preview = self.source.check()
        with patch('sources.skills.write_json', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.source.apply(preview)
        self.assertEqual(self.source.current()[0]['snapshot']['skills']['review']['revision'], self.initial)
        self.assertEqual(list((self.base / 'versions').iterdir()), [])

    def test_node_preview_detects_changes_and_ignores_upload_paths(self):
        preview = self.controller.inspect({}, preview=True)
        self.skill(self.gateway.managers['first'].root, 'review', 'conflict')
        result = self.controller.apply_sync(preview)
        by_id = {r['id']: r for r in result['nodes']}
        self.assertEqual(by_id['first']['status'], 'conflict')
        self.assertEqual(by_id['second']['status'], 'verified')
        self.assertFalse(result['complete'])

    def test_partial_failure_and_noop_followup(self):
        self.gateway.fail.add('second')
        preview = self.controller.inspect({}, preview=True)
        result = self.controller.apply_sync(preview)
        self.assertFalse(result['complete'])
        self.assertEqual({r['status'] for r in result['nodes']}, {'verified', 'skipped'})
        self.gateway.fail.clear()
        next_preview = self.controller.inspect({}, preview=True)
        self.assertTrue(next_preview['nodes'][0]['no_op'])
        self.assertTrue(self.controller.apply_sync(next_preview)['complete'])

    def test_node_extras_survive_and_removed_common_is_pruned(self):
        self.controller.apply_sync(self.controller.inspect({}, preview=True))
        for manager in self.gateway.managers.values():
            self.skill(manager.root, 'private', 'keep')
        shutil.rmtree(self.repo / 'skills/review')
        self.skill(self.repo / 'skills', 'replacement', 'new')
        self.commit()
        self.source.apply(self.source.check())
        preview = self.controller.inspect({}, preview=True)
        self.assertTrue(any(a['op'] == 'remove' for a in preview['nodes'][0]['plan']['actions']))
        self.assertTrue(self.controller.apply_sync(preview)['complete'])
        for manager in self.gateway.managers.values():
            self.assertTrue((manager.root / 'private').is_dir())
            self.assertFalse((manager.root / 'review').exists())

    def test_noop_preview_cannot_turn_into_unreviewed_write(self):
        self.controller.apply_sync(self.controller.inspect({}, preview=True))
        preview = self.controller.inspect({}, preview=True)
        self.skill(self.gateway.managers['first'].root, 'review', 'external edit')
        result = self.controller.apply_sync(preview)
        self.assertEqual(result['nodes'][0]['status'], 'needs_review')

    def test_overview_shows_last_status_from_any_run(self):
        self.assertNotIn('status', self.controller.execute('overview', {})['nodes'][0])
        self.controller.inspect({})
        again = Controller(self.root, self.base, self.gateway)
        nodes = {n['id']: n for n in again.execute('overview', {})['nodes']}
        self.assertEqual(nodes['first']['status'], 'ready')
        self.assertIn('skills', nodes['first'])
        self.assertNotIn('stale', nodes['first'])
        result = self.controller.apply_sync(self.controller.inspect({}, preview=True))
        self.assertTrue(result['complete'])
        nodes = {n['id']: n for n in self.controller.execute('overview', {})['nodes']}
        self.assertEqual(nodes['second']['status'], 'verified')
        self.assertTrue(nodes['second']['consistent'])

    def test_status_from_older_snapshot_is_marked_stale(self):
        self.controller.inspect({})
        self.skill(self.repo / 'skills', 'review', 'second')
        self.commit()
        self.source.apply(self.source.check())
        node = self.controller.execute('overview', {})['nodes'][0]
        self.assertTrue(node['stale'])
        self.controller.inspect({})
        self.controller.execute('remove-source', {'id': 'upstream'})
        self.assertNotIn('stale', self.controller.execute('overview', {})['nodes'][0])
        node = {**node}
        self.assertNotIn('skills', node)
        self.assertIn('checked_at', node)

    def test_skipped_and_failed_nodes_keep_useful_status(self):
        self.controller.inspect({})
        self.gateway.fail.add('second')
        self.controller.inspect({})
        nodes = {n['id']: n for n in self.controller.execute('overview', {})['nodes']}
        self.assertEqual(nodes['second']['status'], 'error')
        self.assertIn('offline', nodes['second']['error'])
        (self.base / 'nodes-status.json').write_text('{broken')
        self.assertNotIn('status', self.controller.execute('overview', {})['nodes'][0])

    def test_controller_lock_and_invalid_target(self):
        with self.controller.writing():
            with self.assertRaisesRegex(ValueError, '已有写任务'):
                with self.controller.writing():
                    pass
        with self.assertRaises(ValueError):
            self.controller.targets([])
        with self.assertRaises(ValueError):
            self.controller.targets(['other'])

    def test_preview_from_different_upload_paths_is_equivalent(self):
        manager = self.gateway.managers['first']
        first = manager.apply(skills.parser().parse_args(['sync', '--source', str(self.base / 'common')]))
        copy_path = self.root / 'another-upload'
        shutil.copytree(self.base / 'common', copy_path)
        applied = manager.apply(skills.parser().parse_args(['sync', '--source', str(copy_path),
                                                           '--expected-plan', first['plan_digest'], '--apply']))
        self.assertTrue(applied['applied'])


if __name__ == '__main__':
    unittest.main()
