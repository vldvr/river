"""Create a SevenSave patch from two Windows game ZIPs (no previous ZIP needed on the client)."""
import hashlib
import json
import shutil
import sys
import tempfile
from contextlib import ExitStack
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

BLOCK = 256 * 1024


def make_patch(old_zip, new_zip, output_dir):
    # The target digest distinguishes different builds of the same version.
    with new_zip.open("rb") as src:
        digest = hashlib.file_digest(src, "sha256").hexdigest()
    previous = old_zip.name.removesuffix("-win-x64.zip").rsplit("-", 1)[1]
    name = f"{new_zip.stem}-from-{previous}-{digest}.blocks.zip"
    with tempfile.TemporaryDirectory() as work:
        patch = Path(work) / name
        files, directories = [], []
        with ZipFile(old_zip) as old, ZipFile(new_zip) as new, ZipFile(patch, "w", ZIP_DEFLATED) as out:
            old_names = set(old.namelist())
            for entry in new.infolist():
                path = entry.filename
                if entry.is_dir():
                    directories.append(path.rstrip("/"))
                    continue
                changed = []
                checksum = hashlib.sha256()
                with ExitStack() as stack:
                    src = stack.enter_context(new.open(entry))
                    base = stack.enter_context(old.open(path)) if path in old_names else None
                    for index, block in enumerate(iter(lambda: src.read(BLOCK), b"")):
                        checksum.update(block)
                        if base is None or block != base.read(BLOCK):
                            out.writestr(f"blocks/{len(files)}-{index}", block)
                            changed.append(index)
                files.append(dict(path=path, size=entry.file_size, sha256=checksum.hexdigest(), changed=changed))
            out.writestr("manifest.json", json.dumps(dict(format=1, directories=directories, files=files)))
        if patch.stat().st_size < new_zip.stat().st_size:
            shutil.copyfile(patch, output_dir / name)


if __name__ == "__main__":
    make_patch(*(Path(arg) for arg in sys.argv[1:]))
