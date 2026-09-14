@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  正在把最新内容做成静态网站，然后推送到 GitHub…
echo.
node scripts\export-static.mjs
if %errorlevel% neq 0 (
  echo  ✗ 导出失败，先把上面的报错发给 Codex。
  pause
  exit /b 1
)
git add -A
git -c user.name="zhangyiyi1222" -c user.email="yiyiyi23446fggf@gmail.com" commit -m "更新网站 %date% %time%"
git push
echo.
echo  ✔ 完成！一两分钟后网站就更新了。
echo.
pause
