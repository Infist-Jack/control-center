#!/usr/bin/env python3
"""Sync the six selected capabilities from the official Lark suite archive.

Requires Python 3.10+. JSON stdout; exit 0 = success/current, 1 = update
available (--check only), 2 = failure. Does not install CLI, log in, or commit.
"""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile
import tempfile
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
INDEX = "https://open.feishu.cn/lark-cli/skills/isolated/.well-known/agent-skills/index.json"
SKILLS = ("lark-calendar", "lark-doc", "lark-drive", "lark-im", "lark-shared", "lark-wiki")
STATE = ".upstream.json"
ROUTE = re.compile(r"^- (lark-[a-z0-9-]+)（([^）\n]*)）:.*$", re.MULTILINE)


def download(url):
    if urlsplit(url).scheme != "https":
        raise ValueError("Upstream URLs must use HTTPS")
    request = Request(url, headers={"User-Agent": "control-center-lark-suite-sync"})
    with urlopen(request, timeout=60) as response:
        return response.read()


def fingerprint(folder):
    digest = hashlib.sha256()
    for path in sorted(folder.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Unexpected symlink: {path}")
        if path.is_file() and path.relative_to(folder).as_posix() != STATE:
            digest.update(path.relative_to(folder).as_posix().encode() + b"\0")
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def read_state(target):
    if target.is_symlink():
        raise ValueError("The project suite must be a real directory")
    if not target.exists():
        return None
    state = json.loads((target / STATE).read_text())
    if fingerprint(target) != state["content_sha256"]:
        raise ValueError("Local suite edits detected; preserve or revert them before syncing")
    return state


def extract_suite(data, digest, target):
    if digest != "sha256:" + hashlib.sha256(data).hexdigest():
        raise ValueError("Official archive SHA-256 mismatch")
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or "\\" in member.name:
                raise ValueError(f"Unsafe archive path: {member.name}")
            if not (member.isdir() or member.isfile()):
                raise ValueError(f"Unsupported archive entry: {member.name}")
            if member.isdir():
                continue
            selected = (path.parts == ("SKILL.md",) or
                        len(path.parts) >= 3 and path.parts[0] == "references" and
                        path.parts[1] in SKILLS)
            if not selected:
                continue
            if path in seen:
                raise ValueError(f"Duplicate archive path: {path}")
            seen.add(path)
            output = target / path
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(archive.extractfile(member).read())
            output.chmod(0o755 if member.mode & 0o111 else 0o644)
    for name in SKILLS:
        if not (target / "references" / name / "GUIDE.md").is_file():
            raise ValueError(f"Official archive is missing {name}/GUIDE.md")


def crop_entrypoint(target):
    path = target / "SKILL.md"
    text = path.read_text()
    match = re.fullmatch(r"---\n(.*?)\n---\n(.*)", text, re.DOTALL)
    if not match or not re.search(r"^name: lark-suite$", match[1], re.MULTILINE):
        raise ValueError("Unexpected official suite frontmatter")
    description = re.search(r"^description: (.+)$", match[1], re.MULTILINE)
    if not description:
        raise ValueError("Official suite description is missing")
    body = match[2]
    routes = [route for route in ROUTE.finditer(body) if route[1] in SKILLS]
    if sorted(route[1] for route in routes) != list(SKILLS):
        raise ValueError("Official route format changed or selected routes are missing")
    keywords = list(dict.fromkeys(word for route in routes for word in route[2].split("、")))
    description, count = re.subn(r"（.*?等）", "（" + "、".join(keywords) + "等）",
                                description[1], count=1)
    if count != 1:
        raise ValueError("Official description format changed")
    body = ROUTE.sub(lambda route: route[0] if route[1] in SKILLS else "", body)
    body = re.sub(r"\n{3,}", "\n\n", body)
    # Keep upstream instructions; document the project subset and its updater.
    note = ("\n> 本仓库仅安装下方六项能力。子资料引用未列出的能力时，说明该能力尚未安装，"
            "不要尝试读取其缺失文件。\n"
            "> 项目内套件由仓库根目录的 `python3 scripts/sync-lark-suite.py` 同步；"
            "`lark-cli update` 管理 CLI 与全局 skills，不能替代项目同步。\n")
    path.write_text("---\nname: lark-suite\ndescription: " +
                    json.dumps(description, ensure_ascii=False) + "\n---\n" + note + body.rstrip() + "\n")


def validate_links(target):
    """Check concrete local Markdown links; report uninstalled sibling domains."""
    omitted = set()
    for path in target.rglob("*.md"):
        text = re.sub(r"```.*?```", "", path.read_text(), flags=re.DOTALL)
        for link in re.findall(r"\]\(([^\s)]+)\)", text):
            url = urlsplit(link.strip("<>"))
            if url.scheme or url.netloc or not url.path.endswith(".md") or "<" in url.path:
                continue
            destination = (path.parent / unquote(url.path)).resolve()
            relative = destination.relative_to(target.resolve())
            parts = relative.parts
            if len(parts) >= 2 and parts[0] == "references" and parts[1].startswith("lark-"):
                if parts[1] not in SKILLS:
                    omitted.add(parts[1])
                    continue
            if not destination.exists():
                raise ValueError(f"Broken local reference in {path.relative_to(target)}: {link}")
    if sorted(path.relative_to(target).as_posix() for path in target.rglob("SKILL.md")) != ["SKILL.md"]:
        raise ValueError("Suite must expose exactly one SKILL.md entrypoint")
    return sorted(omitted)


def install(staged, target):
    # Stage on the same filesystem. Restore the original if the final rename fails.
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".lark-suite-sync-", dir=target.parent) as temp:
        temp = Path(temp)
        shutil.copytree(staged, temp / "new")
        if target.exists():
            target.rename(temp / "old")
        try:
            (temp / "new").rename(target)
        except OSError:
            if (temp / "old").exists():
                (temp / "old").rename(target)
            raise


def sync(root, check=False):
    target = root / ".agents/skills/lark-suite"
    previous = read_state(target)
    index = json.loads(download(INDEX))
    entries = [entry for entry in index["skills"] if entry["name"] == "lark-suite"]
    if len(entries) != 1 or entries[0].get("type") != "archive":
        raise ValueError("Official index must contain one lark-suite archive")
    entry = entries[0]
    url = urljoin(INDEX, entry["url"])
    with tempfile.TemporaryDirectory(prefix="lark-suite-sync-") as temp:
        staged = Path(temp)
        extract_suite(download(url), entry["digest"], staged)
        crop_entrypoint(staged)
        omitted = validate_links(staged)
        state = {"source_index": INDEX, "archive_url": url, "archive_digest": entry["digest"],
                 "skills": list(SKILLS), "content_sha256": fingerprint(staged)}
        changed = state != previous
        if changed and not check:
            # Recheck immediately before replacing to catch edits during the download.
            if read_state(target) != previous:
                raise ValueError("Suite changed during sync; retry")
            (staged / STATE).write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
            install(staged, target)
    return {"status": "update_available" if check and changed else "updated" if changed else "current",
            "changed": changed, "archive_digest": state["archive_digest"],
            "skills": list(SKILLS), "uninstalled_references": omitted}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare with upstream without writing files")
    args = parser.parse_args()
    try:
        result = sync(ROOT, args.check)
        print(json.dumps(result, ensure_ascii=False))
        return int(args.check and result["changed"])
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        print(json.dumps({"status": "error", "error": str(error)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
