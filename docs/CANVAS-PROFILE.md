# 1.1 actual-frame investigation and Godot migration

Measured 2026-10-20 using the complete app at localhost:3040, Chromium 154.0.8037.57. The renderer was not changed. Real requestAnimationFrame callback intervals, CDP touch events, long tasks, DOM mutation/layout metrics and function timings were recorded. This headless environment uses ANGLE/Vulkan SwiftShader software rendering; absolute FPS is not representative of real phones or desktop GPUs. Synchronous JavaScript stalls and scheduling defects are nevertheless directly observable.

| Scene | Actual mean FPS | p95 interval | Maximum interval |
|---|---:|---:|---:|
| Desktop 1280×900 DPR1 paused | 60.04 |16.8 ms|16.8 ms|
| Desktop DPR1 continuous wheel |22.84|166.6 ms|850 ms|
| Desktop DPR2 paused |34.71|33.4 ms|50 ms|
| Desktop DPR2 continuous wheel |8.15|933.3 ms|1250 ms|
| Desktop DPR2 continuous pinch |5.63|983.3 ms|1333.2 ms|
| Desktop DPR2 cold night switch |19.94|66.6 ms|1016.6 ms|
| Desktop DPR2 warm night |37.63|33.4 ms|33.4 ms|
| Desktop DPR2 dense static |19.02|66.7 ms|66.7 ms|
| Desktop DPR2 dense 4× simulation |3.70|466.6 ms|466.7 ms|
| Mobile-sized 390×844 DPR2 paused |60.03|16.8 ms|16.8 ms|
| Mobile-sized DPR2 continuous pinch |22.16|333.3 ms|666.6 ms|

The dense fixture inserts 435 residential origins to stress computation; it is a stress fixture, not a claim that this city was built through legal gameplay. Touch uses actual CDP dispatchTouchEvent with two moving contacts. Pinch follows wheel, so some caches have already been warmed. Mobile size is browser emulation, not real phone hardware.

## Root causes

1. **Zoom-triggered synchronous megapixel terrain generation.** `renderer.js:createTerrainChunk` loops over every physical pixel on the main thread. Tier is ceil(DPR×zoom×2)/2: DPR2 at zoom3.6 creates 1950×1950-pixel chunks (~15 MB each). The 96 MB cache churns across zoom tiers. Desktop DPR2 pinch generated 130 chunks, spending 13.275 seconds inside generation out of 14.297 seconds total renderer submission. The viewport cache key also contains the exact camera/zoom, so every move recomposes the entire viewport. Async createImageBitmap occurs after the CPU work and does not offload it.
2. **Submission time was an incomplete performance metric.** Dense paused render submission averaged ~7.1 ms, but actual rAF ran at ~19 FPS. CDP recorded 3.386 seconds task duration vs 0.460 seconds script duration in that stage. Native Canvas raster/composition on this software GPU contributes substantially. Earlier 7–9 ms renderer-only numbers cannot support a smooth-frame claim.
3. **Quadratic service evaluation blocks the main thread.** Dense 4× simulation: 11 simulate calls total 3761.6 ms, ~342 ms each, maximum393.1 ms, against a requested250 ms interval. coveredBy scans all buildings, evaluateNeeds invokes it for11 service categories per residence and repeats shop/beauty/pollution scans; updatePrestige adds5 coverage queries per residence. Buildings and road topology already have caches; the missing optimization is provider-type indexing and coverage fields. DOM layout was only9.6 ms across that stage.
4. **Pause never stops redraw.** input.js loop renders continuously even speed0 and reducedMotion. DPR1 paused made215 renders in3.58 seconds; reduced motion155 in2.58 seconds. The paused dense city thus still consumes the full graphics workload.
5. **HUD churn exists but is secondary.** Tick rewrites hidden task/resource/detail DOM; dense4× had250 mutations. A detail-panel render reached40.4 ms. However neither explains the multi-second zoom stalls or342 ms simulation calls.

## Godot implementation boundary

Use Godot4 Compatibility, single-thread WebAssembly/WebGL2, GDScript. Preserve the JS simulation/save/online authority initially. A versioned JavaScriptBridge transfers one initial snapshot and low-frequency state deltas; never serialize the whole map every visual frame. Godot owns Camera2D, touch picking, stable scene objects, native animation, depth, previews and GPU terrain. Stop the old Canvas/rAF boot completely so there are not two render loops.

Terrain is a world-coordinate CanvasItem shader sampling a small terrain/road mask and reusable textures, rather than building new pixels for each zoom. Buildings use imported high-resolution textures/modules and stable node transforms. Shared ground-anchor sorting must include nature/citizens and split foreground/background architectural occluders; merely enabling y-sort on one node per whole building does not fix interpenetrating courtyard walls.

Night uses shader uniforms/emissive sprites; camera movement does not regenerate tinted atlases. Pause gates animation/update work and requests low-processor rendering when genuinely static. Road-following citizens retain IDs, continuous position and routes across state synchronization.

The JS model still needs incremental service coverage/provider indexes and a bounded low-frequency scheduler. Real-hour construction must use authoritative timestamps, including hidden-tab/offline catchup; visual delta time is not the economic clock.

Acceptance must include actual frame intervals and input response for cold zoom, pan, pinch, night switch and dense simulation on real Android/iOS hardware. Software Chromium remains useful for deterministic correctness and detecting long main-thread tasks, not proving device FPS. Godot Web also requires explicit context-loss/load-size/shader-first-use/browser-touch validation.

Official references:
- https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
- https://docs.godotengine.org/en/stable/tutorials/platform/web/javascript_bridge.html
- https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/canvas_item_shader.html

Raw observations and function metrics: summary.json and per-stage JSON beside this report. Reproduce with actual-frames.cjs. No application source was changed for these measurements.
