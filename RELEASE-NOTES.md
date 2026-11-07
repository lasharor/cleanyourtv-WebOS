## Fixes

- **webOS 26: the remote works on Home right after the TV is switched on.** After a wake LG's window manager did not give Home the
  remote, and nothing worked until Back was held. The launcher now notices that it has no focus and the service lets the Inputs picker
  take the remote for half a second and give it back, without drawing anything (OLED65C54LA, 43.21.77).
