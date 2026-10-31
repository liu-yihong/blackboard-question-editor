# Blackboard Question Editor

> **Disclaimer:** Blackboard is a trademark of Anthology Inc. This is an independent project and is not affiliated with or endorsed by Anthology.

Write test questions in a friendly editor, check them, and download them for Blackboard in one of two ways:

- a **.txt file** to add the questions to a test, via **Upload questions from file**;
- a **question bank (.zip)** to keep them for reuse, via **Manage banks → Import from file**.

No more clicking "Add question" two hundred times. It works with Original course view too.

- **Live site:** <https://liu-yihong.github.io/blackboard-question-editor/>
- **Author:** Yihong Liu (the commander), [blog.yihong-liu.com](https://blog.yihong-liu.com/) & [Claude by Anthropic](https://claude.com/) (who did the dirty coding work)

It is a static website: plain HTML, CSS and JavaScript with no server and no build step. Questions never leave your browser.

## Privacy

Questions stay in your browser. The page never sends them anywhere, and GitHub only sees that someone downloaded the page files.

`index.html` carries a Content Security Policy that only allows files from this site and blocks the page from sending data anywhere. Every library and font is served from this repository, so the page makes no requests to other sites. If someone pastes in a tracker later, the browser blocks it until the policy is deliberately changed.

## Features

- **Two synced editing modes**
  - *Form*: one card per question. Select a letter bubble to mark the correct answer. Enter adds the next choice, and Ctrl/⌘+Enter adds a new question.
  - *Text*: type or paste a whole quiz, for example from Word. Choices start with `a.`, and `*` marks correct ones. The type is detected for you, and errors point to a line number.
- **All 8 question types Ultra can upload**: Multiple choice, Multiple answer, True/False, Essay, Matching, Fill in the blank, Fill in multiple blanks and Numeric.
- **Checks before download**: it catches each error that would make Blackboard silently skip a question, such as a missing correct answer, a blank without answers, a non-numeric answer, or more than 10 blanks.
- **Rich text and math**:
  - Formatting: `**bold**`, `_italic_`, `x^2^`, `H~2~O`, and LaTeX between `$…$`.
  - Math exports in one of three forms: Unicode text, MathML, or LaTeX source.
  - Tables: the *▦ table* button opens a size picker (rows × columns, optional heading row). The table appears in the question as a grid: type into the cells, press Tab to move on, and use its buttons to add or remove rows and columns. The table's bar also aligns it left, center or right. In Text mode a table is written as rows like `| a | b |` (a `|---|---|` line under the first row makes it a heading row), with an optional `{table align=center}` (or `right`) line just above it.
- **Feedback and pictures** (question bank .zip only):
  - *Feedback for students* on each card: what students see when they answer correctly or wrongly. The *Feedback* checkbox above the questions switches it off for a project: the fields are hidden and the question bank leaves feedback out, while anything already written is kept. In Text mode, write `Correct feedback:` and `Incorrect feedback:` lines. Essays have none, because they are graded by hand.
  - Pictures: the *▣ picture* button, or paste or drop an image into any field. The picture shows in the field itself; click it to set its description for screen readers, its size (Small, Medium, Large, Original or a slider) and its alignment (in line, left, center, right), or to replace or remove it. In Text mode it is written as `<img src="name.png" alt="…" width="…" align="…">`.
  - Large photos are shrunk to at most 1600 pixels on the long side so projects stay small.
  - The .txt upload format has no place for feedback or pictures, so the .txt leaves them out and writes a picture's description instead.
- **Projects and importing** (top bar):
  - *New project*, *Open project…* and *Save project* work with `.bbq.json` project files you can reopen or share.
  - *Import questions…* reads an old Blackboard `.txt` upload file, a CSV or Excel sheet in the same layout, or a plain-text quiz.
  - *Paste questions…* takes rows copied from Excel or Google Sheets, or a quiz copied from Word.
  - Any of these files can also be dropped onto the page.
  - Hover over a top-bar button to see what it does.
- **Saving**: work autosaves in the browser.
- **Question bank export**: *Download question bank (.zip)* builds a Blackboard question pool package for Ultra's *Manage banks → Import from file* (or *Pools → Import Pool* in Original view). All 8 types are included, at 1 point each, with feedback, tables and pictures.
- **Large sets**: sets over 250 questions download as several files, because Blackboard recommends at most 250 questions per upload.
- **Nine styles** from the *Style* menu, remembered per browser:
  - *Studio* (the original look).
  - Retro operating systems: *System* (classic Mac), *Windows 98*, *Windows XP*, *Windows 7*. These have a light look only.
  - Clean and modern: *Pico*, *MVP*, *new.css*, *Sakura*.
  - *Day*, *Night* and *Auto* (follow the device) work with Studio and the clean styles.

## How you can use it

1. Write or paste questions. Fix anything flagged in red.
2. Choose **Download .txt**.
3. In Blackboard Ultra, open the test and select **+ → Upload questions from file**, then choose the file.
4. Set point values in Blackboard. Uploaded questions start at 0 points, or at the test's default.

For a question bank, choose **Download question bank (.zip)** instead. In Ultra, open **Manage banks → Import from file** and pick the .zip without unzipping it. The bank is named after the project title, and each question is worth 1 point.

Points, feedback and pictures can't be set in a .txt upload file; add them in Blackboard afterwards, or use the question bank (.zip), which carries feedback and pictures. Bold, italics and math can display differently depending on how a school has set up Blackboard. The **Download a formatting test file** link in the editor makes a three-question file to try once in a practice test.

## Files

```
index.html          page markup, footer text and Content Security Policy
favicon.svg         logo and browser-tab icon (monochrome Noto Emoji "keyboard")
css/app.css         all styling, including the nine styles
js/theme.js         applies the saved style and Day/Night choice before the page paints, and hides the editor until it is drawn
js/richtext.js      formatting and math markup
js/richfield.js     the visual fields: tables and pictures shown and edited in place
js/model.js         question types and checks
js/bbtxt.js         reading and writing Blackboard's tab-delimited files
js/bbpool.js        writing Blackboard question pool packages (.zip) for bank import, with feedback and pictures
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

## Licences

The editor's own code: MIT

Third-party parts and their licences:
- KaTeX: MIT (`vendor/LICENSE-KaTeX.txt`)
- SheetJS Community Edition: Apache 2.0 (`vendor/LICENSE-SheetJS.txt`)
- IBM Plex fonts: SIL Open Font License 1.1 (`fonts/LICENSE-IBM-Plex.txt`)
- Inter font: SIL Open Font License 1.1 (`fonts/LICENSE-Inter.txt`)
- Noto Emoji "keyboard" artwork (monochrome set): SIL Open Font License 1.1, by Google (`fonts/LICENSE-Noto-Emoji.txt`)

The question bank (.zip) export is this project's own code. Pictures are packed the way Learn exports embedded files (`csfiles/home_dir/name__xid-N_1.png`, referenced as `@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-N_1`), as seen in senkyoshi's tests and R/exams. Its format follows Anthology's question bank documentation and real Blackboard pool exports: Moodle's Blackboard import test fixtures (GPL v3), the qti_pool.xml fixture in Atomic Jolt's senkyoshi (AGPL v3), and R/exams' `exams2blackboard`. The Oklahoma Christian University Blackboard Test Generator showed that a pool .zip made outside Blackboard imports cleanly. No code from these projects is included.

The retro and modern styles are re-created in this project's own CSS, inspired by System.css, 98.css, XP.css, 7.css, Pico CSS, MVP.css, new.css and Sakura (all MIT). No code from those projects is included. The editor's Credits window lists them with links.
