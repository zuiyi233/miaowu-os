# Design

## Boundaries

- Work inside `deer-flow-main/hyperframes/miaowu-product-video`.
- Do not modify unrelated backend/frontend business code.
- Preserve the existing HyperFrames standalone HTML approach unless the current render chain forces a minimal local helper script.
- Keep the deliverable as a standalone vertical video project with assets under `assets/` and rendered output under `renders/`.

## Content Design

The video is rebuilt around a shared timeline table. Each row owns:

- a time range,
- a narration sentence or short paragraph,
- one on-screen scene state,
- one subtitle block,
- optional dynamic title or feature labels.

The content sequence is:

1. Pain hook: AI writing starts fast, then long-form work loses control.
2. Pain breakdown: character drift, worldbuilding conflict, forgotten foreshadowing, fragmented chapters, repeated background explanation.
3. Product positioning: Miaowu OS is an AI novel creation workspace, not a generic chatbot.
4. Feature modules: character profiles, worldbuilding database, relationship/plotline state, outline/chapter workflow, project context memory, rewrite/polish/review loop.
5. Value summary: transforms one-off generation into a manageable, traceable, iterative workflow.
6. Closing: open-source AI novel creation system for 100k+ word and series projects.

## Technical Design

- `script.txt` is the canonical spoken script.
- `index.html` embeds the same timeline as scene/caption JavaScript data so visuals and subtitles are maintained together.
- Captions are short Chinese subtitle blocks, generally one spoken sentence or half sentence per block.
- Scenes are expanded from broad generic slides into more granular functional sections so the video can carry the extra product detail.
- Audio generation uses the already tested local MOSS-TTS-Nano API at `http://localhost:18083/api/generate` when available.
- Final audio should be normalized with FFmpeg `loudnorm` or equivalent. If FFmpeg is not available, install or use a local binary before final render.

## Compatibility And Risk

- HyperFrames package versions in `package.json` remain pinned to the current `0.6.40` line.
- Existing user/unrelated repository modifications must not be reverted.
- If the HyperFrames renderer still has the bundled-version animation-map failure, patch only the local project copy or wrapper needed for this project.
- Long narration generation can be slow with local TTS; split generation is acceptable only if final audio is stitched cleanly.

## Verification

- Run the HyperFrames check/render commands when the environment allows.
- Extract representative frames after render and inspect scene/subtitle alignment.
- Use audio metadata/loudness checks when FFmpeg tools are available.
