# Change Log

All notable changes to the "cue" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [v0.1.0]

-   Initial release

## [v0.2.0]

-   Sign macos cueimports binaries. This fixes a bug where cueimports doesn't run on macos.

## [v0.3.0]

-   Fix display of multi-line errors.
-   Fix line and col position of errors.
-   By default, the linter now uses the "-c" flag but skips all "incomplete" errors. See https://github.com/cue-lang/cue/issues/1928.
    If any flag is set in the `lintFlags` option, this behavior is disabled.

## [v0.3.1]

-   Fix download of x84_64 cueimports
