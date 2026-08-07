@echo off
cd /d "%~dp0"
echo === SYMES Deploy === > push-log.txt 2>&1

if exist .git\index.lock (
  del /f .git\index.lock >> push-log.txt 2>&1
  echo Lock index eliminado >> push-log.txt
)
if exist .git\HEAD.lock (
  del /f .git\HEAD.lock >> push-log.txt 2>&1
  echo Lock HEAD eliminado >> push-log.txt
)

echo [1/4] Agregando archivos... >> push-log.txt
git add -A >> push-log.txt 2>&1

echo [2/4] Commit... >> push-log.txt
git commit -m "chore: update symes" >> push-log.txt 2>&1

echo [3/4] Push a GitHub... >> push-log.txt
git push origin main >> push-log.txt 2>&1

echo [4/4] Deploy a Cloudflare Pages... >> push-log.txt
npx wrangler pages deploy . --project-name=symes-final --branch=main --commit-dirty=true > deploy-out.txt 2>&1
type deploy-out.txt >> push-log.txt

echo [5/5] Promoviendo a produccion... >> push-log.txt
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$out = Get-Content 'deploy-out.txt' -Raw; " ^
  "$m = [regex]::Match($out, 'https://([a-f0-9]+)\.symes-final\.pages\.dev'); " ^
  "if (-not $m.Success) { Write-Host 'ERROR: no se encontro deployment ID'; exit 1 } " ^
  "$depId = $m.Groups[1].Value; " ^
  "Write-Host \"Deployment ID: $depId\"; " ^
  "$cfgPath = \"$env:USERPROFILE\.wrangler\config\default.toml\"; " ^
  "if (-not (Test-Path $cfgPath)) { $cfgPath = \"$env:APPDATA\wrangler\config\default.toml\" }; " ^
  "$cfg = Get-Content $cfgPath -Raw -ErrorAction SilentlyContinue; " ^
  "$tok = [regex]::Match($cfg, 'oauth_token\s*=\s*\"(.+?)\"'); " ^
  "if (-not $tok.Success) { Write-Host 'ERROR: token no encontrado en ' + $cfgPath; exit 1 } " ^
  "$token = $tok.Groups[1].Value; " ^
  "$acct = '3f7c9500199ebe7817ae0875b86d6ea0'; " ^
  "$proj = 'symes-final'; " ^
  "$url = \"https://api.cloudflare.com/client/v4/accounts/$acct/pages/projects/$proj/deployments/$depId/rollback\"; " ^
  "$h = @{ Authorization = \"Bearer $token\"; 'Content-Type' = 'application/json' }; " ^
  "$r = Invoke-RestMethod -Uri $url -Method POST -Headers $h -Body '{}' -ErrorAction SilentlyContinue; " ^
  "if ($r.success) { Write-Host 'PRODUCCION ACTUALIZADA exitosamente' } else { Write-Host 'Respuesta: ' + ($r | ConvertTo-Json) }" ^
  >> push-log.txt 2>&1

echo === FIN === >> push-log.txt
del deploy-out.txt 2>nul
type push-log.txt
pause
