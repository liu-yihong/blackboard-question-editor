# Blackboard Question Editor

Write test questions in a friendly editor, check them, and download a file for **Blackboard Ultra → Upload questions from file**. No more clicking "Add question" two hundred times.

- **Live site:** <https://liu-yihong.github.io/blackboard-question-editor/> (after GitHub Pages is turned on, see below)
- **Author:** Yihong Liu, [blog.yihong-liu.com](https://blog.yihong-liu.com/)

It is a static website: plain HTML, CSS and JavaScript with no server and no build step. Questions never leave the instructor's browser.

## Features

- **Two synced editing modes**
  - *Form*: one card per question. Select a letter bubble to mark the correct answer. Enter adds the next choice, and Ctrl/⌘+Enter adds a new question.
  - *Text*: type or paste a whole quiz, for example from Word. Choices start with `a.`, and `*` marks correct ones. The type is detected for you, and errors point to a line number.
- **All 8 question types Ultra can upload**: Multiple choice, Multiple answer, True/False, Essay, Matching, Fill in the blank, Fill in multiple blanks and Numeric.
- **Checks before download**: it catches each error that would make Blackboard silently skip a question, such as a missing correct answer, a blank without answers, a non-numeric answer, or more than 10 blanks.
- **Rich text and math**:
  - Formatting: `**bold**`, `_italic_`, `x^2^`, `H~2~O`, and LaTeX between `$…$`.
  - Math exports in one of three forms: Unicode text, MathML, or LaTeX source.
- **Projects and importing** (top bar):
  - *New project*, *Open project…* and *Save project* work with `.bbq.json` project files you can reopen or share.
  - *Import questions…* reads an old Blackboard `.txt` upload file, a CSV or Excel sheet in the same layout, or a plain-text quiz.
  - *Paste questions…* takes rows copied from Excel or Google Sheets, or a quiz copied from Word.
  - Any of these files can also be dropped onto the page.
  - Hover over a top-bar button to see what it does.
- **Saving**: work autosaves in the browser.
- **Large sets**: sets over 250 questions download as several files, because Blackboard recommends at most 250 questions per upload.
- **Nine styles** from the *Style* menu, remembered per browser:
  - *Studio* (the original look).
  - Retro operating systems: *System* (classic Mac), *Windows 98*, *Windows XP*, *Windows 7*. These have a light look only.
  - Clean and modern: *Pico*, *MVP*, *new.css*, *Sakura*.
  - *Day*, *Night* and *Auto* (follow the device) work with Studio and the clean styles.

## Put it online with GitHub Pages (free)

1. Sign in at <https://github.com> as `liu-yihong` and create a **new public repository** named `blackboard-question-editor`. Leave "Add a README file" unticked, since this folder has one.
2. On the repository page, choose **uploading an existing file** (or **Add file → Upload files**). Drag in everything in this folder, keeping the `css`, `js`, `vendor`, `fonts` and `examples` folders. Then select **Commit changes**.
   - The `.nojekyll` file is hidden on most computers. GitHub Pages works without it, so don't worry if it doesn't upload.
3. Open **Settings → Pages**. Under *Build and deployment*, set *Source* to **Deploy from a branch**, choose **main** and **/ (root)**, and select **Save**.
4. After about a minute the site is live at `https://liu-yihong.github.io/blackboard-question-editor/`.

To publish an update, upload the changed files again; Pages redeploys automatically.

If you pick a different repository name, change the GitHub link in the footer of `index.html` (search for `github.com/liu-yihong`) and the links at the top of this README.

Other free static hosts work with the same files:
- **Cloudflare Pages** or **Netlify**: drag and drop this folder into their dashboard.
- **Your institution's web server**: copy the folder to any web directory.

You can also open `index.html` directly from your computer, without hosting.

## How instructors use it

1. Write or paste questions. Fix anything flagged in red.
2. Choose **Download .txt**.
3. In Blackboard Ultra, open the test and select **+ → Upload questions from file**, then choose the file.
4. Set point values in Blackboard. Uploaded questions start at 0 points, or at the test's default.

For a question bank, go to Question Banks and choose **+ → Import from file**. Or upload the questions into a test, then reuse them from a bank.

Points, feedback and images can't be set in an upload file; add them in Blackboard afterwards. Bold, italics and math can display differently depending on how a school has set up Blackboard. The **Download a formatting test file** link in the editor makes a three-question file to try once in a practice test.

## Files

```
index.html          page markup, footer text and Content Security Policy
favicon.svg         logo and browser-tab icon (Noto Emoji "memo")
css/app.css         all styling, including the nine styles
js/theme.js         applies the saved style and Day/Night choice before the page paints
js/richtext.js      formatting and math markup
js/model.js         question types and checks
js/bbtxt.js         reading and writing Blackboard's tab-delimited files
js/plaintext.js     Text mode (numbered quiz format)
js/app.js           the editor interface
vendor/             KaTeX (math preview) and SheetJS (Excel import), served locally
fonts/              Inter (new.css style) and IBM Plex fallback fonts, served locally
examples/           a sample upload file, a sample text quiz and a spreadsheet template
```

The `examples` folder has the same MIS question set in three forms:
- `sample-blackboard-upload.txt`: ready to upload to Ultra as is.
- `sample-text-quiz.txt`: the Text-mode format, to paste into the editor.
- `spreadsheet-template.csv`: one row per question, to fill in with Excel or Google Sheets and then open with *Import questions…*.

## Updating the footer

The footer is in `index.html`, inside `<footer class="site-foot">`.
- **Last updated date:** change both the `datetime="2026-10-28"` value and the visible text each time you publish changes.
- **Links:** the blog and GitHub links sit next to the date.

## Privacy

Questions stay in the instructor's browser. The page never sends them anywhere, and GitHub only sees that someone downloaded the page files.

`index.html` carries a Content Security Policy that only allows files from this site and blocks the page from sending data anywhere. Every library and font is served from this repository, so the page makes no requests to other sites. If someone pastes in a tracker later, the browser blocks it until the policy is deliberately changed.

**If you want visitor counts**, avoid general-purpose trackers and session-replay tools.
- Google Analytics and tag managers can be reconfigured remotely to collect more than page views.
- Session-replay tools such as Hotjar or Microsoft Clarity record what people type, which here means exam questions and answer keys.

A cookieless page-view counter (GoatCounter, Plausible, or Cloudflare Web Analytics) is a lighter choice. It still needs its domain added to `script-src` and `connect-src`; keep the policy otherwise intact.

## Licences

Third-party parts and their licences:
- KaTeX: MIT (`vendor/LICENSE-KaTeX.txt`)
- SheetJS Community Edition: Apache 2.0 (`vendor/LICENSE-SheetJS.txt`)
- IBM Plex fonts: SIL Open Font License 1.1 (`fonts/LICENSE-IBM-Plex.txt`)
- Inter font: SIL Open Font License 1.1 (`fonts/LICENSE-Inter.txt`)
- Noto Emoji "memo" artwork: Apache 2.0, by Google, via svgmoji (MIT)

The retro and modern styles are re-created in this project's own CSS, inspired by System.css, 98.css, XP.css, 7.css, Pico CSS, MVP.css, new.css and Sakura (all MIT). No code from those projects is included. The editor's Credits window lists them with links.

The editor's own code doesn't have a licence file yet. Without one, others may view the code but not legally reuse it. To let other instructors adapt it, add one on GitHub with **Add file → Create new file**, name it `LICENSE`, and pick a template such as MIT.

Blackboard is a trademark of Anthology Inc. This is an independent project and is not affiliated with or endorsed by Anthology.
