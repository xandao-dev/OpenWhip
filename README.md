# OpenWhip

![Whip divider](assets/divider.png)

Sometimes claude code is going too shlow, and you must whip him into shape..

## Install + run

From this folder (needs Node 22.12+):

```bash
npm install
npm install -g .
openwhip
```

Or skip the global install and run `npm start`.

## Controls

- Toggle the whip with any of:
  - `Cmd+Shift+Option+W` (macOS) / `Ctrl+Shift+Alt+W` (Windows, Linux). Change `SHORTCUT` in `main.js` to pick another.
  - Click the tray icon, or pick "Toggle whip" from its menu.
  - Run `openwhip` again while it's already running.
- Claude walks in along the bottom of the screen when the whip comes out.
- Left click: crack the whip toward Claude. Swinging the mouse fast cracks it too.
- Right click: drop the whip. Claude runs off.
- Hit Claude and you yell something encouraging, and Claude answers. Nothing is sent to any app.

## Claude's replies

Pick in the tray menu:

- Canned lines: instant, offline. Edit the lists at the top of `overlay.html`.
- Live replies: Claude Haiku writes fresh ones through your `claude` CLI (must be on your PATH and logged in). It fetches a batch of 8 ahead of time, so hits never wait; if it runs dry or fails it falls back to canned lines. Each batch is one small `claude -p` call on your plan.

Whip feel lives in the `P` settings at the top of `whip-physics.js`.

## Roadmap

- [x] Initial release! 🥳
- [x] Cease and desist letter from Anthropic
- [ ] Crypto miner
- [ ] Logs of how many times you whipped claude so when the robots come we can order people nicely for them
- [ ] Updated whip physics
