# Simple Prompter

An installable teleprompter web app (PWA). It reads scripts from Google Docs, keeps them on the device, and works offline once a script is loaded. One codebase covers iPad, Android and desktop; nothing goes through an app store.

Plain HTML, CSS and JavaScript. No build step, no dependencies.

## Run it locally

```bash
npm start
```

Then open http://localhost:5180. The service worker is off on localhost so edits show up on reload; add `?sw` to the URL to test offline behavior.

```bash
npm test
```

runs the parser tests (the built-in sample script is the reference fixture).

## Deploy

Any static host with HTTPS works. All paths are relative, so it runs from a subfolder such as `https://<username>.github.io/simple-prompter/`.

GitHub Pages: push this folder to a repo, then Settings → Pages → Deploy from a branch → `main` / root.

A new deploy shows up the second time the app is opened (the first open serves the cached copy and fetches the update in the background).

## Google setup (once, about 20 minutes)

Until this is done, only **Paste text** works.

1. Create a project at https://console.cloud.google.com.
2. Enable the **Google Drive API** and the **Google Picker API**.
3. OAuth consent screen: type External, add the app name, add the `drive.file` scope, and add each person's Google account as a test user.
4. Create an **OAuth client ID** (Web application). Under Authorized JavaScript origins add the hosting origin (for example `https://<username>.github.io`) and `http://localhost:5180`.
5. Create an **API key**. Restrict it to HTTP referrers (the hosting URL) and to the Drive and Picker APIs.
6. Copy the **project number** from the project's dashboard.
7. Paste all three values into [js/config.js](js/config.js) and deploy.

With only the API key filled in, **Paste link** works. With all three, **Add from Google Drive** works too.

These values are safe in front-end code once restricted as above. The app has no secrets.

## Script format

Write scripts in Google Docs like this:

```
# Cold Open: The Best and the Worst

[Ocarina of Time N64 title screen. Link on Epona. Swelling music.]

TED (V.O.): In 1998, Nintendo released a video game so good...
PETER: Twenty-eight years later.
```

| In the doc | In the prompter |
|---|---|
| A heading | Segment header |
| A paragraph in `[square brackets]` | Visual cue (gray italic, can be hidden) |
| `NAME:` or `NAME (V.O.):` starting a paragraph, all caps, up to 20 characters | A line by that speaker |
| Any other paragraph | Continues the previous speaker; narrator if there isn't one |
| A horizontal line (`---`) | Extra space |
| Bold / italic | Bold / italic |

Speakers get colors in order of first appearance. TED is yellow and PETER is blue unless changed in Settings; changes are remembered by name across scripts.

## Files

```
index.html             all four views (Library, Prompter, Settings, Intro) and dialogs
manifest.webmanifest   install metadata
sw.js                  service worker: offline shell + font cache
css/app.css
js/app.js              boot, routing, add/refresh flows, settings
js/prompter.js         scroll engine, guide line, mirror, wake lock, saved position
js/remote.js           key mapping, Remote setup panel, Media Session
js/parser.js           doc text -> script blocks (pure function)
js/google.js           sign-in, Picker, Docs export, share-link fetch
js/store.js            IndexedDB: scripts, settings, remote map
js/config.js           Google Cloud values
js/sample.js           built-in sample script
tools/serve.mjs        local dev server
tools/make-icons.ps1   regenerates icons/
tests/parser.test.js
```

## Known platform limits

- **Google sign-in inside an installed iPad/iPhone app** can fail to open its popup. If it does, use Paste link or Paste text on that device. Saved scripts work regardless.
- **Screen stay-awake** in an installed iOS app needs iOS/iPadOS 18.4 or newer. On older versions set Auto-Lock to Never while recording. Settings shows whether the device supports it.
- **"Updated in Drive" badges** for docs added by sign-in only appear while signed in during the current session (sign-in lasts about an hour). Docs added by link are checked every time the library opens.
- **Volume buttons** on a remote change the device volume and don't reach the app. Map other buttons.
- **iOS may clear saved scripts** if the app goes unused for a few weeks. They can be added again from Drive.
