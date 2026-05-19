import tomllib, pathlib
paths = [
 r"D:/miaowu-os/deer-flow-main/backend/uv.lock",
 r"D:/miaowu-os/.tmp-head-uv.lock",
 r"D:/miaowu-os/.tmp-local-uv.lock",
 r"D:/miaowu-os/.tmp-base-uv.lock",
 r"D:/miaowu-os/.tmp-upstream-uv.lock",
 r"D:/miaowu-os/.tmp-uv-base.lock",
 r"D:/miaowu-os/.tmp-uv-upstream.lock",
 r"D:/miaowu-os/.tmp-uv-head.lock",
]
for p in paths:
    pp = pathlib.Path(p)
    if not pp.exists():
        print(f"MISSING {p}")
        continue
    try:
        tomllib.loads(pp.read_text(encoding='utf-8'))
        print(f"OK {p}")
    except Exception as e:
        print(f"BAD {p} :: {e}")
