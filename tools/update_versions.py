#!/usr/bin/env python3
"""キャッシュ用の番号（?v=）を、読み込むファイルの中身から自動で決める。

map画面/ の HTML・JavaScript にある、同じサイト内の .js / .css の読み込み
（<script src>・<link href>・import 文・import()）すべてに
「?v=ファイルの中身から作った8文字」を付ける。
ファイルの中身が変わると番号も変わるので、ブラウザに古いファイルが残っていても
新しいものが読み込まれる（手で番号を上げる必要がない）。

使い方（リポジトリの一番上で）:
    python3 tools/update_versions.py          # 番号を書きかえる
    python3 tools/update_versions.py --check  # 書きかえが必要なら一覧を出して失敗する（CI 用）
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "map画面"

# "./x.js" "../js/x.js?v=3" '../css/x.css' のような、同じサイト内の .js / .css への参照
REFERENCE = re.compile(r"""(["'])((?:\.\.?/)[^"'?#\s]+\.(?:js|css))(?:\?v=[^"']*)?\1""")


def source_files():
    return sorted(
        path for path in ROOT.rglob("*")
        if path.suffix in (".html", ".js") and path.is_file()
    )


def file_hash(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()[:8]


def rewrite(path):
    """path の中の参照を、今の中身の番号にした文字列を返す。"""
    text = path.read_bytes().decode("utf-8")  # 改行（CRLF）をそのまま残す

    def replace(match):
        quote, target = match.group(1), match.group(2)
        referenced = (path.parent / target).resolve()
        if not referenced.is_file() or ROOT not in referenced.parents:
            return match.group(0)
        return f"{quote}{target}?v={file_hash(referenced)}{quote}"

    return text, REFERENCE.sub(replace, text)


def main():
    check = "--check" in sys.argv
    changed = set()

    # 読み込むファイルの番号が変わると、読み込む側の中身も変わるので、変わらなくなるまでくり返す
    for _ in range(20):
        round_changed = False
        for path in source_files():
            before, after = rewrite(path)
            if before != after:
                changed.add(path.relative_to(ROOT.parent))
                round_changed = True
                if not check:
                    path.write_bytes(after.encode("utf-8"))
        if check or not round_changed:
            break
    else:
        sys.exit("番号が決まりませんでした（読み込みが輪になっていませんか？）")

    if check:
        if changed:
            print("キャッシュ用の番号（?v=）が古いファイルがあります。次を実行してコミットしてください:")
            print("    python3 tools/update_versions.py")
            for path in sorted(changed):
                print("  -", path)
            sys.exit(1)
        print("キャッシュ用の番号（?v=）はすべて最新です。")
    else:
        for path in sorted(changed):
            print("更新:", path)
        if not changed:
            print("変更はありません。")


if __name__ == "__main__":
    main()
