import tomllib, pathlib
p = pathlib.Path(r"D:/miaowu-os/deer-flow-main/backend/uv.lock")
d = tomllib.loads(p.read_text(encoding='utf-8'))
packages = d.get('package', [])
for pkg in packages:
    if pkg.get('name') == 'urllib3':
        print('urllib3', pkg.get('version'))
        break
else:
    print('urllib3 NOT_FOUND')
