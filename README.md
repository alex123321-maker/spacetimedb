# Continuum Grid

## Local Development

1. Start local SpacetimeDB:
```powershell
npm run spacetime:start:local
```
2. Run module in dev mode (regenerates bindings against local DB name):
```powershell
npm run spacetime:dev
```
3. Start client:
```powershell
npm run client:dev
```

## Deploy to Maincloud

1. Login once:
```powershell
spacetime login
```
2. Publish module to Maincloud:
```powershell
spacetime publish continum-grids-3vxm5 --server maincloud
```
3. Optional clean publish (drops existing data):
```powershell
spacetime publish continum-grids-3vxm5 --server maincloud --delete-data
```

Notes:
- `enableTestAdmin` defaults to `false` in server config.
- `adminClaimGenerator` stays gated by `enableTestAdmin` and is test/admin-only.

## Client Build (Static)

Build static assets:
```powershell
npm run build:client
```

Preview build locally:
```powershell
npm run preview:client
```

The output folder is `dist/` and can be uploaded to Dokploy static hosting or any static host.
