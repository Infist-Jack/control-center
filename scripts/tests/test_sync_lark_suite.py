import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("sync_lark_suite", Path(__file__).parents[1] / "sync-lark-suite.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def fixture(extra=None):
    names = (*sync.SKILLS, "lark-task")
    routes = "\n".join(f"- {name}（{name}）: capability" for name in names)
    files = {"SKILL.md": "---\nname: lark-suite\nversion: 0.1.0\n"
             "description: 飞书/Lark 聚合能力入口：管理飞书/Lark 产品能力（全部等）。\n---\n"
             "# Lark Suite\n\n" + routes + "\n"}
    for name in names:
        files[f"references/{name}/GUIDE.md"] = "# Guide\n[Shared](../lark-shared/GUIDE.md)\n"
    files["references/lark-im/references/messages.md"] = "[IM](../GUIDE.md)\n[Task](../../lark-task/GUIDE.md)\n"
    files.update(extra or {})
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for path, text in files.items():
            data = text.encode()
            member = tarfile.TarInfo(path)
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    return output.getvalue()


def source(data):
    index = {"skills": [{"name": "lark-suite", "type": "archive", "url": "./lark-suite.tar.gz",
                         "digest": "sha256:" + hashlib.sha256(data).hexdigest()}]}
    return lambda url: json.dumps(index).encode() if url == sync.INDEX else data


class SuiteSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / ".agents/skills/lark-suite"

    def run_sync(self, data=None, check=False):
        with patch.object(sync, "download", side_effect=source(data or fixture())):
            return sync.sync(self.root, check)

    def test_check_does_not_write_and_sync_is_idempotent(self):
        self.assertEqual(self.run_sync(check=True)["status"], "update_available")
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertEqual(self.run_sync()["status"], "updated")
        state = (self.target / sync.STATE).read_bytes()
        self.assertEqual(self.run_sync(check=True)["status"], "current")
        self.assertEqual(self.run_sync()["status"], "current")
        self.assertEqual((self.target / sync.STATE).read_bytes(), state)
        self.assertFalse((self.target / "references/lark-task").exists())
        self.assertEqual(list(self.target.rglob("SKILL.md")), [self.target / "SKILL.md"])
        self.assertEqual(sync.validate_links(self.target), ["lark-task"])

    def test_update_removes_stale_files_and_preserves_other_skills(self):
        self.run_sync(fixture({"references/lark-im/references/old.md": "old"}))
        neighbor = self.target.parent / "custom-skill/SKILL.md"
        neighbor.parent.mkdir()
        neighbor.write_text("local skill")
        self.assertEqual(self.run_sync()["status"], "updated")
        self.assertFalse((self.target / "references/lark-im/references/old.md").exists())
        self.assertEqual(neighbor.read_text(), "local skill")

    def test_local_edits_are_not_overwritten(self):
        self.run_sync()
        guide = self.target / "references/lark-im/GUIDE.md"
        guide.write_text("user changes")
        with self.assertRaisesRegex(ValueError, "Local suite edits"):
            self.run_sync()
        self.assertEqual(guide.read_text(), "user changes")

    def test_invalid_archive_leaves_existing_suite_intact(self):
        self.run_sync()
        before = sync.fingerprint(self.target)
        broken = fixture({"references/lark-im/GUIDE.md": "[Missing](references/missing.md)"})
        with self.assertRaisesRegex(ValueError, "Broken local reference"):
            self.run_sync(broken)
        self.assertEqual(sync.fingerprint(self.target), before)

    def test_checksum_mismatch_is_rejected_before_extraction(self):
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            sync.extract_suite(fixture(), "sha256:wrong", self.root)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_archive_cannot_escape_target(self):
        for path in ("../escape.md", "/absolute.md"):
            with self.subTest(path=path):
                with self.assertRaisesRegex(ValueError, "Unsafe archive path"):
                    self.run_sync(fixture({path: "bad"}))
                self.assertFalse(self.target.exists())

    def test_archive_symlinks_are_rejected(self):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as archive:
            link = tarfile.TarInfo("references/lark-im/link")
            link.type = tarfile.SYMTYPE
            link.linkname = "/tmp"
            archive.addfile(link)
        with self.assertRaisesRegex(ValueError, "Unsupported archive entry"):
            self.run_sync(output.getvalue())

    def test_missing_route_is_rejected(self):
        bad = fixture({"SKILL.md": "---\nname: lark-suite\ndescription: 测试（全部等）。\n---\n# No routes\n"})
        with self.assertRaisesRegex(ValueError, "selected routes are missing"):
            self.run_sync(bad)
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
