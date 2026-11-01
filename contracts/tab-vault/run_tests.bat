@echo off
set "PATH=C:\Users\philo\AppData\Local\Microsoft\WinGet\Packages\MartinStorsjo.LLVM-MinGW.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\llvm-mingw-20260908-ucrt-x86_64\bin;C:\Users\philo\.cargo\bin;%PATH%"
cargo test --lib %*
