# task-progress: a progress bar for Claude Code

A Claude Code mod that puts a compact progress bar above the prompt while Claude works through a task, so you can see how far along it is without watching every message.

```
51%  Step 3 of 5 · Add captions                         ⏱ about 9 min left
[ ✓ ][ ✓ ][ 3 ▓▓░ ][ 4 ][ 5 ]
Now: Rendering the captions · 2 of 5 done · 9 min in            Show steps
```

- **Step N of M** and the name of the step Claude is on.
- **Now:** what Claude is doing at that moment (reading files, running a command, using the browser…).
- **Time left:** the average time of the finished steps times the steps still to go. Time spent waiting for your reply isn't counted. Before the first step is done it uses the average from your earlier tasks.
- **A step strip:** green ticks for done steps, an orange segment filling up for the current one, grey for steps not started.
- **Show steps** lists every step. When everything is done it says how long the task took and sends a notification.
- **Steps stay out of the chat.** The step-list tool rows are hidden. In the desktop app the mod swaps the app's task-list tool for its own step tool (and tells Claude to use it), so the app's task list no longer appears under Claude's messages; the bar shows the same steps. The swap starts with the next new session. `/progress app-list` brings the app's list back (and its commit or pull request buttons at the end of a turn).
- `/progress` shows or hides the step list; `/progress clear` removes the bar.

It reads Claude's own step lists (the desktop app's task list, `TodoWrite`, `TaskCreate`/`TaskUpdate`), so the bar only appears for tasks Claude splits into steps. Time left is an estimate.

Works in the desktop app, the terminal, VS Code and the phone app. The terminal draws it with characters.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install task-progress --marketplace chumorah/claude-progress-bar
```

Answer `y` to add the marketplace, then pick a scope (user is the first one).

From a shell:

```bash
claude plugin install task-progress --marketplace chumorah/claude-progress-bar
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `chumorah/claude-progress-bar`, then **Add plugin**.

Or, on a Mac, without typing the GitHub name: click **Code**, then **Download ZIP** on this page, double-click the zip in Downloads, then in Terminal:

```bash
bash ~/Downloads/claude-progress-bar-main/install.sh
```

The installer keeps a copy in `~/.claude/mods/claude-progress-bar`, so the download can be deleted afterwards. Start a new Claude Code session to see the bar.

To remove it: `claude plugin uninstall task-progress`.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

## License

MIT
