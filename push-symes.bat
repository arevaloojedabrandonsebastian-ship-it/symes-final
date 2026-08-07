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

echo [4/4] Deploy directo a Cloudflare Pages (produccion)... >> push-log.txt
npx wrangler pages deploy . --project-name=symes-final --branch=main --commit-dirty=true >> push-log.txt 2>&1

echo === FIN === >> push-log.txt
type push-log.txt
pause
