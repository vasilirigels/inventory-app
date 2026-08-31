; Custom NSIS macros për ChamShop installer.
;
; DIAGNOSTIKË: dialog-u "Cham Shop non può essere chiuso" mund të vijë nga:
;   1. _CHECK_APP_RUNNING (bllokuar nga customCheckAppRunning — kalojmë)
;   2. installUtil.nsh — kur uninstalluesi i vjetër dështon (skedar në përdorim)
;   3. extractAppPackage.nsh — kur ekstraktimi dështon (skedar në përdorim)
;
; Ky installer shkruan log te %TEMP%\chamshop-installer.log në çdo hap kritik.
; Pas një dështimi, hapni atë skedar dhe dërgojeni për diagnozë.

!include "FileFunc.nsh"

; Hap një dritare PowerShell që tail-on log-un në real-time (si `tail -f`).
; Thirret NJËHERË në krye të preInit. `Exec` kthehet menjëherë (fire-and-forget)
; që installer-i të vazhdojë. Dritarja mbetet e hapur derisa user-i ta mbyllë.
!macro StartLogViewer
  Push $0
  ; Fillo një session të ri log-u (truncate — përndryshe log-ëve të vjetër u
  ; ngjiten të rinjtë dhe s'kuptohet se cili install përket cilit).
  FileOpen $0 "$TEMP\chamshop-installer.log" w
  FileWrite $0 "===== INSTALLER SESSION START =====$\r$\n"
  FileClose $0
  ; Hap dritare PowerShell që bën tail -f mbi file-in. `cmd /C start` nis
  ; procesin në një dritare të re dhe kthehet menjëherë.
  Exec `cmd /C start "Cham Shop Installer LIVE Log" powershell -NoExit -Command "Get-Content -Wait -Path '$TEMP\chamshop-installer.log'"`
  Pop $0
!macroend

!macro LogWrite _MSG
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  ${GetTime} "" "L" $1 $2 $3 $4 $5 $6 $0
  ; $1=day $2=month $3=year $4=dayOfWeek $5=hour $6=minute $0=second
  FileOpen $0 "$TEMP\chamshop-installer.log" a
  FileSeek $0 0 END
  FileWrite $0 "[$3-$2-$1 $5:$6] ${_MSG}$\r$\n"
  FileClose $0
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro LogProcessList _TAG
  Push $R8
  Push $R9
  nsExec::ExecToStack 'cmd /C tasklist /FI "IMAGENAME eq Cham Shop.exe" /FO CSV /NH'
  Pop $R8
  Pop $R9
  !insertmacro LogWrite "[${_TAG}] tasklist exit=$R8 out=$R9"
  Pop $R9
  Pop $R8
!macroend

!macro LogTaskkill _TAG
  Push $R8
  Push $R9
  nsExec::ExecToStack 'cmd /C taskkill /F /T /IM "Cham Shop.exe" 2>&1'
  Pop $R8
  Pop $R9
  !insertmacro LogWrite "[${_TAG}] taskkill exit=$R8 out=$R9"
  Pop $R9
  Pop $R8
!macroend

!macro customCheckAppRunning
  !insertmacro LogWrite "===== customCheckAppRunning START ====="
  !insertmacro LogProcessList "customCheckAppRunning:before-kill"

  !insertmacro LogTaskkill "customCheckAppRunning:kill-1"
  Sleep 1000
  !insertmacro LogTaskkill "customCheckAppRunning:kill-2"
  Sleep 1000
  !insertmacro LogTaskkill "customCheckAppRunning:kill-3"
  Sleep 1000
  !insertmacro LogTaskkill "customCheckAppRunning:kill-4"
  Sleep 1000
  !insertmacro LogTaskkill "customCheckAppRunning:kill-5"

  ; Prit që OS-i të lirojë file handles.
  Sleep 5000

  !insertmacro LogProcessList "customCheckAppRunning:after-wait"
  !insertmacro LogWrite "===== customCheckAppRunning END ====="
!macroend

!macro preInit
  ; Hap live-log viewer që në rreshtin e parë të installer-it.
  !insertmacro StartLogViewer
  !insertmacro LogWrite "===== preInit START ====="
  !insertmacro LogProcessList "preInit:before-kill"
  !insertmacro LogTaskkill "preInit:kill"
  Sleep 500
  !insertmacro LogProcessList "preInit:after-kill"
  !insertmacro LogWrite "===== preInit END ====="
!macroend

!macro customInit
  !insertmacro LogWrite "===== customInit START ====="
  !insertmacro LogProcessList "customInit:before-kill"
  !insertmacro LogTaskkill "customInit:kill"
  Sleep 500
  !insertmacro LogProcessList "customInit:after-kill"
  !insertmacro LogWrite "===== customInit END ====="
!macroend

!macro customInstall
  !insertmacro LogWrite "===== customInstall (Section install starting) ====="
  !insertmacro LogProcessList "customInstall:snapshot"
!macroend

!macro customUnInit
  !insertmacro LogWrite "===== customUnInit START ====="
  !insertmacro LogTaskkill "customUnInit:kill-1"
  Sleep 2000
  !insertmacro LogTaskkill "customUnInit:kill-2"
  Sleep 2000
  !insertmacro LogTaskkill "customUnInit:kill-3"
  Sleep 2000
  !insertmacro LogWrite "===== customUnInit END ====="
!macroend
