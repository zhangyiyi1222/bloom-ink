@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  正在把代码推送到 GitHub（第一次会弹出一个登录窗口，登录你的 GitHub 账号即可）
echo  可能要几分钟，因为要传 150MB 左右，请耐心等它跑完。
echo.
git push -u origin main
echo.
if %errorlevel%==0 (
  echo  ✔ 推送完成！回到 GitHub 页面刷新一下就能看到文件了。
) else (
  echo  ✗ 推送失败。把上面的红字截图发给 Codex 看看。
)
echo.
pause
