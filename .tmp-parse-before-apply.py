import tomllib, pathlib
p = pathlib.Path(r"D:/miaowu-os/.tmp-before-apply-uv.lock")
try:
    tomllib.loads(p.read_text(encoding='utf-8'))
    print('OK_BEFORE_APPLY')
except Exception as e:
    print('BAD_BEFORE_APPLY', e)
