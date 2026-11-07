# Working on problems with an AI assistant

If something does not work on your TV, an AI assistant (Claude, ChatGPT, Gemini, a local model) can help you find out why, and, if you
want, help you fix the bug in the code and send the fix. This page says what to give it and how to keep it safe. Nothing here is
required: **Share log** and an [issue](https://github.com/lasharor/cleanyourtv-WebOS/issues) work as before.

## The ground rules

- **Read-only first.** The assistant reads a report. It may run read-only commands on the TV. Anything that changes the TV (restart a
  service, edit a file, install, delete, reboot) is proposed first, you say yes, and it names the command that undoes it.
- **You decide what leaves your house.** A report goes to whatever AI service you use. Addresses, MAC addresses, stream URLs and tokens are
  masked, but masking is best effort: read the file before you paste or upload it. A local model keeps it on your computer.
- **An assistant can be wrong.** Do not run a command you do not understand. The way back is always the same: switch **CleanYourTV as Home**
  off in the manager app, or `sh /media/developer/cleanyourtv/undo-home.sh`, or start the TV in the Homebrew Channel's failsafe mode.

## Part 1: find out what is wrong on your TV

1. **Collect a report.** In the manager app **Share log** shows a QR code for a masked report, or from your computer:

   ```sh
   git clone https://github.com/lasharor/cleanyourtv-WebOS && cd cleanyourtv-WebOS
   sh tools/diagnose.sh <tv-ip> > cytv-diagnose.txt
   ```

   `diagnose.sh` logs in as root over SSH (key authentication, as set up by the Homebrew Channel) and only reads: the Share log report, the
   foreground and running apps, the media pipelines, the processes, the Input key mode, the configuration with secrets hidden, the themes
   on the TV, the service's last operations and the Live TV status. It changes nothing. Open the file and remove anything private.
2. **Give the assistant the context.** Start the conversation with [`AGENTS.md`](https://github.com/lasharor/cleanyourtv-WebOS/blob/main/AGENTS.md)
   (what the project is, where the TV keeps things, what has gone wrong before, the rules) and the report. Tools that read the repository
   (Claude Code, Codex, Cursor and similar) pick `AGENTS.md` up by themselves when you open the folder you cloned.
3. **Ask for a diagnosis, not a fix.** See the prompts below. Ask it to name the evidence in the report for each conclusion.
4. **Try what it suggests, one step at a time**, and tell it what happened. If it is a real bug, open an issue with the report and the
   assistant's findings, or go on with Part 2.

### Prompts

**Diagnose a report**

> I use CleanYourTV on an LG webOS TV. Read AGENTS.md first. Below is a diagnostic report (`tools/diagnose.sh`) and this is what is wrong:
> *describe it: what you did, what you expected, what happened, how often*. Work out the most likely causes from the report. For each, quote
> the lines of the report that support it, and say what would show that it is wrong. Propose read-only checks first. Do not suggest a change
> to the TV without the exact command, what it does and the command that undoes it. Do not ask me for secrets.

**Check the TV live (an agent with SSH)**

> You may run read-only commands on my TV with `ssh root@<tv-ip>` (cat, ls, ps, curl to 127.0.0.1:8765, `luna-send` queries with `</dev/null`).
> Do not change, restart, install, delete or reboot anything without asking me first, and name the undo command. Start from AGENTS.md and
> `tools/diagnose.sh`. The problem: *describe it*. Tell me what you found and what you would try next.

**Understand the code behind a symptom**

> Using AGENTS.md ("Where things are") find the code responsible for *symptom* in this repository. Explain how it works on webOS 5/6 (Node 8.12)
> and on webOS 25, and list what could make it fail on a TV that is not the maintainer's.

## Part 2: fix the bug and send the fix

You need a copy of the repository on your computer, Node.js 22 or newer, and an assistant that can edit files and run commands (Claude Code,
Codex, Cursor, Copilot agent mode and similar). The project's rules are in `AGENTS.md`; the assistant reads them.

1. **Fork and clone**, and make a branch: `git checkout -b fix-short-description`.
2. **Reproduce the bug.** From the report, then from the code. Many bugs can be reproduced without a TV: the service runs under
   `sh tools/check.sh` (the tests under Node 8.12.0, as on webOS 5 and 6, and the current Node), and the launcher page runs in Chrome against a stand-in service (see
   `tools/theme-preview.mjs` for the idea).
3. **Write a test that fails**, then fix the code until it passes. A test in `tools/test/` is expected whenever the bug can be
   tested without a TV. Keep to the compatibility rules (Node 8.12 for the service, ES5 style for the pages).
4. **Run everything:** `sh tools/check.sh`, and `python3 ipk/build.py` to check that the package builds.
5. **Try it on a TV** if you can: once your change is merged into `dev` it is in the dev build (the pre-release `dev`); in the manager
   app **Update channel** > **Dev builds** installs it, and **Update channel** > **Stable releases** goes back. A branch of your own
   can be installed by hand: build it with `python3 ipk/build.py`, copy the `.ipk` to the TV and run `install.sh` with
   `CYTV_IPK=/path/to/package.ipk`. Say in the pull request what you checked on a
   TV and what you did not.
6. **Open a pull request** with the template. Describe the cause, not only the change, and say that AI tools were used.

What a pull request needs: the tests pass under Node 8.12, a new test for the bug where possible, the documentation page changed when the
behaviour changed, no private data (addresses, tokens, playlist URLs, names), an honest note on what was verified on a real TV, and a line
saying which AI tools helped. It is reviewed like any other pull request.

### Prompts

**Fix a bug**

> Read AGENTS.md. Issue: *paste the issue text and the masked report*. Reproduce the problem (a failing test in `tools/test/` if it can
> be tested without a TV), find the cause, and make the smallest fix that follows the rules in AGENTS.md (Node 8.12 for the service, ES5 style
> for the pages, no private data). Run `sh tools/check.sh` and `python3 ipk/build.py`. Update the documentation if behaviour changes.
> Do not commit to main, do not release. Tell me what is verified and what only a real TV can verify.

**Review a change**

> Review my change against AGENTS.md: Node 8.12 compatibility, ES5 style in the pages, private data, missing tests, documentation that no
> longer matches, and anything that could leave a TV in a state it cannot recover from (boot scripts, mounts, the update path).

**Write the pull request text**

> From the diff, write a pull request description: the symptom, the cause, what changed, how it was tested (name the commands), what was
> checked on a real TV and what was not, and a line that AI tools were used.

## Part 3: make an add-on from an idea

An add-on is a folder in a repository of your own; the TV fetches it with `cytv-addons` or the manager. Give the assistant
[Add-on repositories](development/addon-repos.md), the sample in `addons/template/` and your idea; the page has a prompt and a checklist.
The assistant writes files and runs `node make-index.js`; it does not install anything on your TV unless you say so.

## What the assistant should not do

- Run commands on your TV that change it, without asking you first.
- Paste your tokens, playlist address, IP addresses or names into an issue or a pull request.
- Release, tag or force-push. The maintainer releases.
- Copy code from GPL projects into this MIT project.

## Notes for maintainers

`AGENTS.md` (and `CLAUDE.md`, which points to it) is the briefing; keep it short and correct when the layout, the TV facts or the rules
change. The issue form asks for the Share log and, if used, the assistant's findings; the pull request template asks for the checks above.
