// SlotPresentation.js
//
// A companion SCRIPT for a GameObject that already has a Slot Manager
// (and Math Manager) on it. Slot Manager keeps its own Inspector cols/
// rows, the symbol table, the reel-prefab builder, bet levels, button
// wiring none of that changes. This script is the editable layer on
// top of it: everything about how a spin actually *feels* (winning
// symbols punching bigger, reels that scroll and stop instead of
// snapping straight to the result, a free-spins banner, a big-win
// flourish, a win amount banner and win-line overlays) lives here in
// code you can open and change, instead of being baked into the engine.
//
// HOW TO USE
// 1. In the Project panel: New Script -> paste this in (or open the new
//    script and replace its contents) -> name it SlotPresentation.
// 2. Select your Slot Manager's GameObject in the Hierarchy -> Add
//    Component -> Script -> pick SlotPresentation.
// 3. (Optional) Make two small UI GameObjects with a Text Renderer on
//    each one for "FREE SPINS", one for "BIG WIN!" and drag them
//    onto this script's Free Spin Banner / Big Win Banner fields in the
//    Inspector. Leave a field empty to skip that flourish entirely. The
//    Win Banner field and the win-line overlays don't need this step
//    createSlotHUD builds and wires both in automatically.
// 4. Press Play. Reels scroll and stop one after another instead of
//    snapping straight to the result, winning symbols punch, a "+amount"
//    banner and lines light up on any win, free spins show/hide their
//    banner, and a round win worth `bigWinMultiplier`x the bet or more
//    triggers the big-win flourish.
//
// Every method below is a normal starting point, not a fixed rule
// change the punch curve, add sound via Lite.audio.play(...), swap the
// scale punch for a color change once real sprite tinting exists,
// whatever this game needs. It's just code now.
export default class SlotPresentation extends LiteBehaviour {

    // --- Inspector-editable fields ---------------------------------------
    // Each field has to sit alone on its own line, with nothing else
    // trailing it that's what the Inspector's field scanner (JS has no
    // `public` keyword to key off, unlike C#) looks for to know what to
    // expose. Put any explanation on the line above instead of after the
    // semicolon.

    // GameObject with a Text Renderer, shown while free spins are active
    freeSpinBanner = null;
    // GameObject with a Text Renderer, shown briefly on a big win
    bigWinBanner = null;
    // how long the big-win banner stays up, in seconds
    bigWinBannerSeconds = 2.5;
    // how big a winning symbol punches (1 = no punch)
    winPunchScale = 1.18;
    // how long one punch takes to play out, in seconds
    winPunchSeconds = 0.45;
    // punch size for the whole board on a big win
    bigWinPunchScale = 1.4;
    // round win / bet at or above this counts as a "big win"
    bigWinMultiplier = 10;

    // GameObject with a Text Renderer, shown briefly on ANY win (not
    // just a big one) createSlotHUD wires this one in automatically
    // when it builds a board, so it's usually already set
    winBanner = null;
    // how long the win banner (and any win lines see below) stay up, in seconds
    winBannerSeconds = 1.5;
    // color the win-line overlays draw in
    winLineColor = '#ffd700';
    // width of a win-line overlay, in world units
    winLineWidth = 0.08;

    // how fast the reels visually scroll at full speed, in world units/second
    spinScrollSpeed = 50;
    // how long the FIRST reel spins at full speed, in seconds, before it stops
    spinBaseSeconds = 1.0;
    // time between one reel stopping and the next, left to right, in
    // seconds -- this is what makes the reels stop one by one
    spinStaggerSeconds = 0.22;
    // how long a reel takes to get up to full speed when a spin starts,
    // in seconds (0 = instant, which reads as a jolt)
    reelAccelSeconds = 0.08;
    // how a reel stops: 'bounce' = it runs at full speed right up to its
    // stop and lands with a kick (the classic reel), 'ease' = it slows down
    // over the last few symbols
    reelStopStyle = 'bounce';
    // how far a landing reel dips past its resting spot before easing
    // back, as a fraction of one symbol (0 = no bounce, it just stops)
    reelSettleBounce = 0.22;
    // how long that settle takes, in seconds
    reelSettleSeconds = 0.2;

    // --- anticipation ------------------------------------------------------
    // When the reels that already stopped are one step from a win (set up
    // on the Slot Manager: Anticipation -- which reels, how many reels
    // trigger it, how long each one waits), the next reel keeps spinning
    // longer, faster, then slows down onto its result while the stopped
    // reels dim. Turn the whole thing off on the Slot Manager.
    // spin speed of an anticipating reel, times spinScrollSpeed
    anticipationSpeed = 1.3;
    // how long an anticipating reel takes to slow down and stop, in seconds
    anticipationLandSeconds = 0.7;
    // how bright the stopped reels stay while another reel anticipates (1 = no dimming)
    anticipationDim = 0.45;
    // optional GameObject (a glow, a frame, a particle effect): copied onto
    // each anticipating reel and shown while it waits
    anticipationEffect = null;

    // fake motion blur while a reel is spinning fast (a vertical
    // stretch + fade, the classic cheap slot-machine trick, not a
    // real image blur) -- on by default. The blur follows the reel's
    // actual speed, so it builds as the reel speeds up and fades as it
    // slows down to land
    reelBlur = true;
    // how much taller a symbol stretches at full blur (1 = no stretch)
    reelBlurStretch = 1.6;
    // how transparent a symbol gets at full blur (1 = fully opaque)
    reelBlurOpacity = 0.55;

    // --- fitting the screen ------------------------------------------------
    // Re-arrange the HUD and refit the camera whenever the Game view (or
    // the game's window) changes size or is rotated, so the slot always
    // fills the screen: landscape keeps the layout as you built it, a
    // portrait screen stacks the stats above and below the reels instead
    // of beside them, and spare room pushes the HUD out toward the edges
    // instead of leaving empty bands. Turn off to keep the camera exactly
    // as set in the Inspector.
    responsiveLayout = true;
    // screens narrower than this (width / height) get the portrait layout
    portraitAspect = 1.0;
    // space kept between the layout and the screen edges, in world units
    screenMargin = 0.35;
    // how far (0 to 1) the HUD rows move out toward the screen edges when
    // there's spare room -- 1 pins them to the edges, 0 keeps them next to the reels
    edgeAnchoring = 1;
    // optional background sprite -- switched to Fill Screen while playing,
    // so it always covers the whole screen (you can also just tick Fill
    // Screen on its Sprite Renderer, which shows in the editor too)
    background = null;

    start() {
        this.slotManager = this.getComponent('slotManager')
        if (!this.slotManager) {
            Debug.warn('SlotPresentation needs a Slot Manager on the same GameObject.')
            return
        }

        // This script decides exactly when a reel visually stops (see
        // _updateReelSpins below), so it calls slotManager.playReelStopSound()
        // itself, right at that moment, rather than letting Slot Manager's OWN
        // automatic stagger guess at timing that has nothing to do with how
        // long a spin actually plays out here. See Slot Manager's own
        // autoReelStopSound field for the full explanation.
        this.slotManager.autoReelStopSound = false

        // transform -> its resting scale, captured the first time we ever
        // punch it, so repeated wins always punch from the real authored
        // scale instead of from wherever the last punch left off.
        this._baseScale = new Map()
        // transform -> its resting SpriteRenderer opacity, captured the
        // same way, so reel blur's fade always eases back to what the
        // symbol was actually authored at rather than assuming 1
        this._baseOpacity = new Map()
        // Punches currently animating: { transform, baseScaleX, baseScaleY, punch, duration, elapsed }
        this._flashes = []
        this._bigWinTimer = 0
        // Reels currently mid-spin (see _onSpinStart for the shape of one)
        this._reelSpins = []
        // col -> the one extra, hidden symbol each reel borrows while it
        // scrolls (see _reelCells). Built once, here, so the first spin
        // doesn't hitch creating them.
        this._buffers = new Map()
        // Flips false the instant a spin starts and back to true once the
        // real result (board/demo board) has actually landed a reel is
        // never allowed to stop spinning before both its own timer AND
        // this are true, so a slow round never reveals a snapped-to-rest
        // reel showing last round's symbols while still "spinning".
        this._boardReady = true
        // How long left to show the win banner / win-line overlays for.
        this._winTimer = 0

        this._unsubs = [
            this.slotManager.on('spinStart', () => this._onSpinStart()),
            this.slotManager.on('board', (board) => this._onBoard(board)),
            this.slotManager.on('winInfo', (info) => this._onWinInfo(info)),
            this.slotManager.on('freeSpinTrigger', (info) => this._onFreeSpinTrigger(info)),
            this.slotManager.on('freeSpinEnd', () => this._onFreeSpinEnd()),
            this.slotManager.on('roundEnd', (result) => this._onRoundEnd(result)),
            this.slotManager.on('error', (err) => Debug.error(`[SlotPresentation] ${err.message}`)),
        ]

        this._setBannerActive(this.freeSpinBanner, false)
        this._setBannerActive(this.bigWinBanner, false)
        this._setBannerActive(this.winBanner, false)

        for (let c = 0; c < this.slotManager.cols; c++) this._reelCells(c)

        this._initResponsive()
    }

    onDisable() {
        for (const unsub of this._unsubs || []) unsub()
        this._unsubs = []
        // Leave every reel exactly on its grid, with the spare symbols hidden
        for (const spin of this._reelSpins || []) this._restReel(spin)
        this._reelSpins = []
        for (const buffer of (this._buffers || new Map()).values()) buffer.active = false
        this._setDim(false)
        for (const fx of (this._effects || new Map()).values()) fx.active = false
    }

    update(deltaTime) {
        if (this.responsiveLayout) this._updateResponsive()
        if (this._reelSpins && this._reelSpins.length) this._updateReelSpins(deltaTime)
        if (this._flashes && this._flashes.length) {
            this._flashes = this._flashes.filter((f) => {
                f.elapsed += deltaTime
                const progress = Math.min(f.elapsed / f.duration, 1)
                // Up and back down smoothly (a half sine, 0 -> 1 -> 0) rather
                // than a hard snap, so the punch reads as a bounce, not a glitch.
                const punch = 1 + (f.punch - 1) * Math.sin(progress * Math.PI)
                f.transform.scaleX = f.baseScaleX * punch
                f.transform.scaleY = f.baseScaleY * punch
                return progress < 1
            })
        }
        if (this._bigWinTimer > 0) {
            this._bigWinTimer -= deltaTime
            if (this._bigWinTimer <= 0) {
                this._bigWinTimer = 0
                this._setBannerActive(this.bigWinBanner, false)
            }
        }
        if (this._winTimer > 0) {
            this._placeWinLines()
            this._winTimer -= deltaTime
            if (this._winTimer <= 0) {
                this._winTimer = 0
                this._setBannerActive(this.winBanner, false)
                this._hideWinLines()
            }
        }
    }

    // --- event handlers ---------------------------------------------------

    // Starts every reel scrolling at once, each with its own landing time
    // (see spinBaseSeconds/spinStaggerSeconds). A reel is modelled as one
    // continuous strip: `u` is how many symbols it has scrolled so far, and
    // every symbol's position is worked out from that single number each
    // frame (see _placeReel), so nothing can drift apart or jump. The strip
    // has one more symbol than the board has rows -- that spare is what
    // keeps the reel window full the whole way through a scroll, instead
    // of opening a gap every time a symbol wraps around.
    //
    // phase: 'spin' (speeding up, then full speed) -> 'land' (slowing
    // down onto the real result) -> 'settle' (the small bounce) -> gone.
    _onSpinStart() {
        this._boardReady = false
        // last round's lines go as the reels start moving
        this._winTimer = 0
        this._setBannerActive(this.winBanner, false)
        this._hideWinLines()
        // A spin that never finished (a very quick re-spin) is put on its
        // grid first, so the new one always starts from a clean layout.
        for (const old of this._reelSpins) this._restReel(old)
        const sm = this.slotManager
        const spins = []
        for (let c = 0; c < sm.cols; c++) {
            const cells = this._reelCells(c)
            if (!cells) continue
            cells[0].active = true
            spins.push({
                col: c,
                // [spare symbol, row 0, row 1, ...]
                cells,
                phase: 'spin',
                elapsed: 0,
                stopAt: this._stopTime(c, 0),
                // anticipation for this reel this round ({ seconds, reason })
                // or null, set once the result is known (see _onBoard)
                antic: null,
                anticStartAt: Infinity,
                anticipating: false,
                // symbols scrolled so far (fractional), the whole-symbol
                // step already handled, and the current speed (units/s)
                u: 0,
                step: 0,
                speed: 0,
                // landing: where it started, where it ends (a whole
                // number of symbols), how far, how long, how far along
                landFrom: 0,
                landU: 0,
                landDistance: 0,
                landSeconds: 1,
                landElapsed: 0,
                settleElapsed: 0,
                // what the spare symbol shows once the reel is at rest
                topId: null,
            })
        }
        this._reelSpins = spins
        this._anticPlan = []
        this._setDim(false)
    }

    // When reel `col` stops: the stagger between reels, plus the extra
    // anticipation time of every anticipating reel up to and including it
    // (each one waits for the reels before it to finish first).
    _stopTime(col, extraUpTo) {
        return this.spinBaseSeconds + col * this.spinStaggerSeconds + extraUpTo
    }

    // The round's result has arrived: work out which reels anticipate and
    // when every reel stops. If the result came in late (a slow network),
    // the whole stopping sequence is pushed back from now, so the reels
    // still stop one by one instead of all at once.
    _onBoard(board) {
        this._boardReady = true
        const sm = this.slotManager
        const plan = typeof sm.anticipationReels === 'function' ? sm.anticipationReels(board?.grid) : []
        this._anticPlan = plan
        const byCol = new Map(plan.map((a) => [a.col, a]))
        const now = this._reelSpins.reduce((m, sp) => Math.max(m, sp.elapsed), 0)
        const late = Math.max(0, now - this.spinBaseSeconds)
        let extra = 0
        for (const spin of [...this._reelSpins].sort((x, y) => x.col - y.col)) {
            const a = byCol.get(spin.col) || null
            if (a) extra += a.seconds
            if (spin.phase !== 'spin') continue
            spin.antic = a
            spin.stopAt = this._stopTime(spin.col, extra) + late
            spin.anticStartAt = a ? spin.stopAt - a.seconds : Infinity
        }
    }

    _onWinInfo(info) {
        const amount = info?.amount ?? info?.win ?? info?.total ?? 0
        if (amount <= 0) return
        // Flashes exactly the winning cells when the math config reports
        // them (the common Stake Engine shape is an array of positions
        // like { reel, row } rename these two lines if your math config
        // calls them something else, e.g. { col, row }). With nothing
        // usable there, the whole board punches instead so a win still
        // reads as a win either way.
        const positions = info?.positions || info?.winningPositions || null
        if (Array.isArray(positions) && positions.length) {
            for (const p of positions) this._punchCell(p.reel ?? p.col, p.row)
        } else {
            this._punchBoard(this.winPunchScale, this.winPunchSeconds)
        }

        this._setBannerActive(this.winBanner, true)
        this._setBannerText(this.winBanner, `+${amount.toFixed(2)}`)
        this._winTimer = this.winBannerSeconds

        // `lines`, if present, is SlotManager's own local evaluator shape
        // (see evaluateWin()/demoSpin() on SlotManager itself): one entry
        // per winning payline, each with its own `positions`. A live RGS
        // round that doesn't fill this in simply draws no lines the
        // symbol punch above still shows a win happened either way.
        if (Array.isArray(info?.lines) && info.lines.length) this._drawWinLines(info.lines)
    }

    _onFreeSpinTrigger(info) {
        this._setBannerActive(this.freeSpinBanner, true)
        this._setBannerText(this.freeSpinBanner, `FREE SPINS: ${info?.freeSpins ?? this.slotManager.freeSpinsRemaining}`)
    }

    _onFreeSpinEnd() {
        this._setBannerActive(this.freeSpinBanner, false)
    }

    _onRoundEnd(result) {
        const bet = this.slotManager.bet || 0
        const win = result?.win || 0
        if (bet <= 0 || win / bet < this.bigWinMultiplier) return
        this._punchBoard(this.bigWinPunchScale, this.winPunchSeconds * 1.6)
        this._setBannerActive(this.bigWinBanner, true)
        this._setBannerText(this.bigWinBanner, `BIG WIN! ${win.toFixed(2)}`)
        this._bigWinTimer = this.bigWinBannerSeconds
    }

    // --- fitting the screen -------------------------------------------------
    // Everything here works from what's actually in the scene -- the board
    // size from Slot Manager, and the position/size of every direct child
    // of the SlotHUD object -- so HUD items you add, move or delete
    // yourself are laid out too, not just the ones createSlotHUD made.
    // Anything above the reels counts as the top row, anything below as the
    // bottom row, anything beside them as the side panel. Positions are
    // only changed while playing; Stop puts everything back as you left it.

    _initResponsive() {
        this._hud = this.gameObject.transform.children.find((c) => c.name === 'SlotHUD') || null
        // Where every HUD item was placed in the editor. Each relayout
        // starts from these, so layouts never drift from repeated resizes.
        this._authored = new Map()
        for (const item of this._hudItems()) {
            const t = item.transform
            const tr = item.getComponent('textRenderer')
            this._authored.set(item, { x: t.x, y: t.y, scaleX: t.scaleX, scaleY: t.scaleY, align: tr ? tr.align : null })
        }

        const camComp = Lite.camera.main
        this._camComp = camComp
        const bgRenderer = this.background ? this.background.getComponent('spriteRenderer') : null
        if (bgRenderer) bgRenderer.fillScreen = true

        // Portrait Zoom / Portrait Offset set on the camera mean you're
        // framing portrait screens yourself -- this script then leaves the
        // camera and HUD alone rather than fight your settings.
        const cam = camComp ? camComp.camera : null
        this._manualFraming = !!cam && (cam.portraitZoom !== 1 || cam.portraitOffsetX !== 0 || cam.portraitOffsetY !== 0)
        if (this._manualFraming && this.responsiveLayout) {
            Debug.log('[SlotPresentation] Camera has Portrait Zoom/Offset set, so the automatic layout is off. Reset them to 1 / 0 to use it.')
        }
        this._screenKey = ''
    }

    // Cheap enough to run every frame: only does real work when the
    // screen size actually changed since the last layout.
    _updateResponsive() {
        const w = Lite.screen.width
        const h = Lite.screen.height
        if (!w || !h || !this._camComp || this._manualFraming) return // Game view hidden, or framed by hand
        const key = w + 'x' + h
        if (key === this._screenKey) return
        this._screenKey = key
        this._applyLayout(w, h)
    }

    _applyLayout(screenW, screenH) {
        const sm = this.slotManager
        const halfW = (sm.cols * sm.reelSpacing) / 2
        const halfH = (sm.rows * (Number(sm.symbolSpacing) || 1)) / 2
        const portrait = screenW / screenH < this.portraitAspect

        // 1. Start from the layout as built, then rearrange for portrait.
        for (const [item, pos] of this._authored) {
            item.transform.x = pos.x
            item.transform.y = pos.y
            item.transform.scaleX = pos.scaleX
            item.transform.scaleY = pos.scaleY
            if (pos.align) item.getComponent('textRenderer').align = pos.align
        }
        // Rows of 3+ items whose texts/buttons run into each other are
        // spaced out so nothing overlaps; in portrait they're also kept
        // within the reels' width (shrinking a little if they must), so
        // the reels -- not a wide button row -- decide how big it all is.
        if (portrait) this._layoutPortrait(halfW, halfH)
        const rowWidth = portrait ? halfW * 2 : Infinity
        for (const row of this._rows(halfW, halfH)) this._packRow(row, rowWidth)

        // 2. Fit the camera to everything, the same way Fit Camera to Slot
        //    does in the editor: a reference size that exactly holds the
        //    layout (plus margin), which the camera then scales to fit
        //    this screen as large as possible.
        const groups = this._groups(halfW, halfH)
        const local = this._bounds([...groups.top, ...groups.bottom, ...groups.side], { left: -halfW, right: halfW, top: halfH, bottom: -halfH })
        const board = this.gameObject.transform.getWorld()
        const sx = Math.abs(board.scaleX) || 1
        const sy = Math.abs(board.scaleY) || 1
        const m = this.screenMargin
        const worldW = (local.right - local.left) * sx + m * 2
        const worldH = (local.top - local.bottom) * sy + m * 2
        const centerX = board.x + ((local.left + local.right) / 2) * board.scaleX
        const centerY = board.y + ((local.top + local.bottom) / 2) * board.scaleY

        const camComp = this._camComp
        const cam = camComp.camera
        const zoom = cam.zoom && cam.zoom > 0 ? cam.zoom : 100
        cam.zoom = zoom
        cam.matchScreenSize = true
        cam.referenceWidth = Math.max(1, Math.round(worldW * zoom))
        cam.referenceHeight = Math.max(1, Math.round(worldH * zoom))
        this._placeCamera(camComp, centerX, centerY)

        // 3. Whatever room the screen has beyond that goes to the HUD:
        //    top row up, bottom row down, side panel outward -- so a tall
        //    phone gets reels in the middle with the title and controls at
        //    the edges, instead of a small block with empty bands.
        const pixelsPerUnit = cam.getEffectiveZoom(screenW, screenH)
        const spareW = Math.max(0, screenW / pixelsPerUnit - worldW)
        const spareH = Math.max(0, screenH / pixelsPerUnit - worldH)
        const k = Math.max(0, Math.min(1, this.edgeAnchoring))
        const moveY = ((spareH / 2) * k) / sy
        for (const item of groups.top) item.transform.y += moveY
        for (const item of groups.bottom) item.transform.y -= moveY
        // The side panel only drifts part of the way: pinned to the far
        // edge of an ultrawide screen it would end up a long way from the
        // reels it describes.
        const moveX = Math.min(((spareW / 2) * k) / sx, halfW)
        for (const item of groups.side) item.transform.x += item.transform.x < 0 ? -moveX : moveX
    }

    // Portrait: the side panel becomes a two-column block under the bottom
    // row, and a top row with more than two items wraps into two columns
    // so it fits the board's width.
    _layoutPortrait(halfW, halfH) {
        const { top, bottom, side } = this._groups(halfW, halfH)
        // Two columns meeting in the middle: the left column's texts end at
        // the center line and the right column's start there, so a stat
        // that grows ("Total Win 1250.00 USD") grows outward instead of
        // into its neighbour. Buttons/shapes go at the quarter points.
        const place = (item, col) => {
            const tr = item.getComponent('textRenderer')
            if (tr && !this._isShape(item)) {
                tr.align = col === 0 ? 'right' : 'left'
                item.transform.x = this._fromBoardX(col === 0 ? -0.15 : 0.15)
            } else {
                item.transform.x = this._fromBoardX(col === 0 ? -halfW / 2 : halfW / 2)
            }
        }

        // Top row(s): the lowest line of the top group wraps into 2 columns.
        const firstRowY = top.length ? Math.min(...top.map((i) => i.transform.y)) : 0
        const row = top.filter((i) => Math.abs(i.transform.y - firstRowY) < 0.05).sort((a, b) => a.transform.x - b.transform.x)
        if (row.length > 2) {
            const lineH = this._lineHeight(row)
            const rows = Math.ceil(row.length / 2)
            row.forEach((item, i) => {
                place(item, i % 2)
                item.transform.y = firstRowY + (rows - 1 - Math.floor(i / 2)) * lineH
            })
            // everything above that row (the title) moves up to make room
            for (const item of top) if (!row.includes(item)) item.transform.y += (rows - 1) * lineH
        }

        // Side panel: two columns, reading order kept (top-to-bottom as built).
        if (side.length) {
            const lowest = bottom.length ? this._bounds(bottom, null).bottom : -halfH
            const lineH = this._lineHeight(side)
            const ordered = [...side].sort((a, b) => b.transform.y - a.transform.y || a.transform.x - b.transform.x)
            ordered.forEach((item, i) => {
                place(item, i % 2)
                item.transform.y = lowest - lineH * (0.9 + Math.floor(i / 2))
            })
        }
    }

    // Items above or below the reels that share a line (same y), 3 or more
    // to a line. Two items on one line are usually deliberate (a label over
    // a shape) and are left alone.
    _rows(halfW, halfH) {
        const { top, bottom } = this._groups(halfW, halfH)
        const lines = new Map()
        for (const item of [...top, ...bottom]) {
            const key = Math.round(item.transform.y * 20)
            if (!lines.has(key)) lines.set(key, [])
            lines.get(key).push(item)
        }
        return [...lines.values()].filter((line) => line.length >= 3)
    }

    // Lays one row out left to right with a small gap, centered where the
    // row was centered, only if it currently overlaps or is wider than
    // maxWidth. Shrinks the row (never below 70%) when it can't fit
    // maxWidth at full size.
    _packRow(items, maxWidth) {
        const gap = 0.25
        const row = [...items].sort((a, b) => a.transform.x - b.transform.x)
        // Measured by their real text here (plus the gap), not the roomier
        // estimate used for fitting the camera, so rows pack snugly.
        const rects = row.map((item) => this._itemRect(item, 0))
        const overlaps = rects.some((r, i) => i > 0 && r.left < rects[i - 1].right)
        const left = Math.min(...rects.map((r) => r.left))
        const right = Math.max(...rects.map((r) => r.right))
        // With a width limit the row must sit inside the reels' span
        // (centered under them), not just be narrow enough.
        const fits = maxWidth === Infinity ? true : left >= -maxWidth / 2 - 0.01 && right <= maxWidth / 2 + 0.01
        if (!overlaps && fits) return
        if (row.length < 2) return

        const widths = rects.map((r) => r.right - r.left)
        const total = widths.reduce((a, w) => a + w, 0) + gap * (row.length - 1)

        // Too wide for the reels (a phone held upright): rather than shrink
        // the buttons, plain text items (e.g. "Bet: 1.00") move to a line
        // of their own just above, and the buttons keep their full size.
        const texts = row.filter((item) => !this._isShape(item))
        const shapes = row.filter((item) => this._isShape(item))
        if (total > maxWidth && texts.length && shapes.length > 1) {
            const lift = (this._lineHeight(shapes) + this._lineHeight(texts)) / 2
            for (const item of texts) item.transform.y += lift / (this._hud.transform.scaleY || 1)
            this._packRow(shapes, maxWidth)
            if (texts.length > 1) this._packRow(texts, maxWidth)
            else texts[0].transform.x = this._fromBoardX(0)
            return
        }

        const scale = Math.max(0.7, Math.min(1, maxWidth / total))
        const center = maxWidth === Infinity ? (left + right) / 2 : 0
        let x = center - (total * scale) / 2
        row.forEach((item, i) => {
            const t = item.transform
            const r = rects[i]
            // keep each item's own anchor (a left-aligned text's anchor is
            // its left edge, a centered one its middle)
            const anchorOffset = (this._toBoard(t.x, t.y).x - r.left) * scale
            t.scaleX *= scale
            t.scaleY *= scale
            t.x = this._fromBoardX(x + anchorOffset)
            x += (widths[i] + gap) * scale
        })
    }

    // Direct children of SlotHUD that take part in the layout. Banners and
    // win lines sit over the reels and stay where they are.
    _hudItems() {
        if (!this._hud) return []
        const skip = new Set(['WinBanner', 'FreeSpinBanner', 'WinLines', 'BonusBuyPanel', 'FreeSpinCounter'])
        for (const b of [this.winBanner, this.bigWinBanner, this.freeSpinBanner]) if (b) skip.add(b.name)
        return this._hud.transform.children.filter((c) => !skip.has(c.name))
    }

    _groups(halfW, halfH) {
        const top = []
        const bottom = []
        const side = []
        for (const item of this._hudItems()) {
            const p = this._toBoard(item.transform.x, item.transform.y)
            if (p.y > halfH) top.push(item)
            else if (p.y < -halfH) bottom.push(item)
            else if (Math.abs(p.x) > halfW) side.push(item)
        }
        return { top, bottom, side }
    }

    // Bounding box, in board space, of a set of HUD items, optionally
    // grown to include `start` (the reels).
    _bounds(items, start) {
        let b = start ? { ...start } : { left: Infinity, right: -Infinity, top: -Infinity, bottom: Infinity }
        for (const item of items) {
            const r = this._itemRect(item)
            b.left = Math.min(b.left, r.left)
            b.right = Math.max(b.right, r.right)
            b.top = Math.max(b.top, r.top)
            b.bottom = Math.min(b.bottom, r.bottom)
        }
        return b
    }

    // Approximate on-screen rectangle of one HUD item, in board space --
    // a shape's own size, or a text's width at the same 0.6-per-character
    // estimate the renderer uses. Live stat texts are measured as at least
    // 14 characters so a growing balance doesn't outgrow its space.
    _isShape(item) {
        const sr = item.getComponent('spriteRenderer')
        return !!(sr && sr.shapeType)
    }

    _itemRect(item, minStatChars = 14) {
        const t = item.transform
        const p = this._toBoard(t.x, t.y)
        const sx = Math.abs(t.scaleX) || 1
        const sy = Math.abs(t.scaleY) || 1
        let w = 0.5
        let h = 0.5
        let align = 'center'
        const sr = item.getComponent('spriteRenderer')
        const tr = item.getComponent('textRenderer')
        if (sr && sr.shapeType) {
            w = sr.shapeWidth
            h = sr.shapeHeight
        } else if (tr) {
            const chars = Math.max(String(tr.text || '').length, item.getComponent('slotStatText') ? minStatChars : 1, 1)
            w = chars * tr.fontSize * 0.6
            h = tr.fontSize * 1.2
            align = tr.align || 'center'
        }
        w *= sx
        h *= sy
        const left = align === 'left' ? p.x : align === 'right' ? p.x - w : p.x - w / 2
        return { left, right: left + w, top: p.y + h / 2, bottom: p.y - h / 2 }
    }

    _lineHeight(items) {
        let size = 0.3
        for (const item of items) {
            const tr = item.getComponent('textRenderer')
            const sr = item.getComponent('spriteRenderer')
            if (tr) size = Math.max(size, tr.fontSize * 1.3)
            if (sr && sr.shapeType) size = Math.max(size, sr.shapeHeight * 1.15)
        }
        return size
    }

    // HUD-local -> board-local (SlotHUD is normally at 0,0, scale 1).
    _toBoard(x, y) {
        const h = this._hud.transform
        return { x: h.x + x * h.scaleX, y: h.y + y * h.scaleY }
    }

    _fromBoardX(x) {
        const h = this._hud.transform
        return (x - h.x) / (h.scaleX || 1)
    }

    // The Game view reads the camera's position from its GameObject's
    // transform every frame, so that's what gets moved.
    _placeCamera(camComp, worldX, worldY) {
        this._placeWorld(camComp.gameObject, worldX, worldY)
    }

    _placeWorld(go, worldX, worldY) {
        const t = go.transform
        const parent = t.parent
        if (!parent) {
            t.x = worldX
            t.y = worldY
            return
        }
        const pw = parent.transform.getWorld()
        t.x = (worldX - pw.x) / (pw.scaleX || 1)
        t.y = (worldY - pw.y) / (pw.scaleY || 1)
    }

    // --- helpers ------------------------------------------------------------
    // Follows the exact same Reel_{col}/Symbol_{row} naming Slot Manager's
    // own applyBoardToGrid() uses, via its reelName()/symbolName() methods,
    // so this never drifts out of sync with however Build Grid actually
    // named things.

    // Returns [spare, row 0, row 1, ...] for one reel, or null if the reel
    // (or one of its row symbols) isn't in the scene. The spare is a copy
    // of the reel's first symbol, made once and kept hidden between spins.
    _reelCells(col) {
        const sm = this.slotManager
        const reel = this._reelsHost().transform.children.find((r) => r.name === sm.reelName(col))
        if (!reel) return null
        const rows = []
        for (let r = 0; r < sm.rows; r++) {
            const symbol = reel.transform.children.find((s) => s.name === sm.symbolName(r))
            if (!symbol) return null
            rows.push(symbol)
        }
        if (!rows.length) return null
        let spare = this._buffers.get(col)
        if (!spare) {
            spare = this._makeSpare(reel, rows[0])
            if (!spare) return null
            this._buffers.set(col, spare)
        }
        return [spare, ...rows]
    }

    // A hidden copy of `source`, parented to the same reel, at the same
    // resting scale/opacity. Named differently from the Symbol_N objects, so
    // Slot Manager's own board-writing (which finds symbols by name) never
    // sees it. Stop discards it with the rest of the play-mode scene.
    _makeSpare(reel, source) {
        const copy = Lite.instantiate(source, null, null, reel)
        if (!copy) return null
        copy.name = 'SpinSpare'
        const t = source.transform
        const base = this._baseScale.get(t) || { x: t.scaleX, y: t.scaleY }
        copy.transform.scaleX = base.x
        copy.transform.scaleY = base.y
        const sr = copy.getComponent('spriteRenderer')
        const sourceSr = source.getComponent('spriteRenderer')
        if (sr && sourceSr) sr.opacity = this._baseOpacity.has(t) ? this._baseOpacity.get(t) : sourceSr.opacity
        copy.active = false
        return copy
    }

    // Steps every spinning reel. A reel keeps moving at full speed until
    // BOTH its own timer has run out AND the real result has arrived, then
    // slows down over several symbols while the real board scrolls in
    // underneath it, and finally eases onto its resting spot. Nothing ever
    // snaps: every position is a smooth function of time.
    _updateReelSpins(deltaTime) {
        // A long frame (a busy moment, a slower frame rate) is played through
        // in small steps, so the reels keep their real speed and timing at
        // any frame rate instead of slowing down. Only a very long stall
        // (over a quarter of a second) is shortened.
        let left = Math.min(deltaTime, 0.25)
        while (left > 1e-6 && this._reelSpins.length) {
            const dt = Math.min(left, 1 / 60)
            left -= dt
            this._reelSpins = this._reelSpins.filter((spin) => this._stepReel(spin, dt))
        }
    }

    // Returns false once the reel has fully come to rest.
    _stepReel(spin, dt) {
        const sm = this.slotManager
        const spacing = (Number(sm.symbolSpacing) || 1)
        spin.elapsed += dt

        if (spin.phase === 'spin') {
            // Smoothstep up to full speed, not a jump straight to it.
            const k = Math.min(1, spin.elapsed / Math.max(0.0001, this.reelAccelSeconds))
            let top = this.spinScrollSpeed
            if (this._boardReady && spin.antic && spin.elapsed >= spin.anticStartAt) {
                if (!spin.anticipating) this._startAnticipation(spin)
                top *= Math.max(0.1, this.anticipationSpeed)
            }
            // eases between normal and anticipation speed instead of jumping
            const target = top * k * k * (3 - 2 * k)
            spin.speed += (target - spin.speed) * Math.min(1, dt * 12)
            if (spin.elapsed < this.reelAccelSeconds) spin.speed = target
            spin.u += (spin.speed * dt) / spacing
            this._feedSteps(spin)
            if (spin.elapsed >= spin.stopAt && this._boardReady) this._beginLanding(spin)
            this._placeReel(spin)
            if (spin.anticipating) this._pulseEffect(spin)
            return true
        }

        if (spin.phase === 'land') {
            spin.landElapsed += dt
            const x = Math.min(1, spin.landElapsed / spin.landSeconds)
            if (spin.landLinear) {
                // 'bounce': full speed right up to the stop
                spin.u = spin.landFrom + spin.landDistance * x
            } else {
                // Ease-out (constant slowdown): starts at the speed the reel
                // already had, so there is no change of pace where it begins.
                const inv = 1 - x
                spin.u = spin.landFrom + spin.landDistance * (1 - inv * inv)
                spin.speed = (spin.landDistance * 2 * inv * spacing) / spin.landSeconds
            }
            if (spin.anticipating) this._pulseEffect(spin)
            if (x < 1) {
                this._feedSteps(spin)
                this._placeReel(spin)
                return true
            }
            // Arrived. The strip is exactly on the grid, so hand each symbol
            // its real place by name (looks identical, see _restReel), and
            // only now tell Slot Manager this reel has stopped.
            spin.u = spin.landU
            spin.speed = 0
            this._feedSteps(spin)
            this._restReel(spin, true)
            sm.playReelStopSound(spin.col)
            this._reelLanded(spin)
            if (this.reelSettleBounce > 0 && this.reelSettleSeconds > 0) {
                spin.phase = 'settle'
                spin.settleElapsed = 0
                return true
            }
            spin.cells[0].active = false
            return false
        }

        // 'settle': dip a little past the resting spot and ease back. sin^2
        // has no slope at either end, so it eases in and out of the dip.
        spin.settleElapsed += dt
        const y = Math.min(1, spin.settleElapsed / this.reelSettleSeconds)
        const s = Math.sin(Math.PI * y)
        this._restReel(spin, false, -this.reelSettleBounce * spacing * s * s)
        if (y < 1) return true
        this._restReel(spin, false)
        spin.cells[0].active = false
        return false
    }

    // Works out where the reel will stop: a whole number of symbols ahead,
    // far enough that every row of the real board still has time to scroll
    // in on its way to the bottom. 'bounce' keeps full speed to that point
    // (the settle kick then stops it); 'ease' and an anticipating reel slow
    // down onto it.
    _beginLanding(spin) {
        const sm = this.slotManager
        spin.phase = 'land'
        spin.landFrom = spin.u
        const v = Math.max(spin.speed, this.spinScrollSpeed * 0.5) / (Number(sm.symbolSpacing) || 1) // symbols per second
        let distance = sm.rows + 1
        spin.landLinear = !spin.anticipating && this.reelStopStyle !== 'ease'
        if (spin.anticipating) {
            // long enough to slow down over anticipationLandSeconds from this speed
            distance = Math.max(distance, Math.round((v * Math.max(0.1, this.anticipationLandSeconds)) / 2))
        }
        spin.landU = Math.floor(spin.u) + distance
        spin.landDistance = spin.landU - spin.u
        spin.landSeconds = spin.landLinear ? spin.landDistance / v : (2 * spin.landDistance) / v
        spin.landElapsed = 0
    }

    // --- anticipation --------------------------------------------------------

    // Reel `spin` starts waiting: the reels before it dim, its effect shows,
    // and Slot Manager plays the Anticipation sound and tells every script
    // (onAnticipation / the 'anticipation' event).
    _startAnticipation(spin) {
        spin.anticipating = true
        this._setDim(true, spin.col)
        const fx = this._effectFor(spin.col)
        if (fx) fx.active = true
        this.slotManager.notifyAnticipation(spin.col, spin.antic.seconds, spin.antic.reason)
    }

    // A reel has come to rest: its effect goes, and when no later reel is
    // going to anticipate, the board brightens again.
    _reelLanded(spin) {
        if (spin.anticipating) {
            const fx = this._effectFor(spin.col, false)
            if (fx) fx.active = false
        }
        // The reels still spinning never stop before this one is down: the
        // next one stops a stagger later (an anticipating one starts waiting
        // right now, for its full time), and so on down the line. An
        // anticipating reel's slow landing can run longer than planned.
        let prev = spin.elapsed
        let first = true
        for (const o of this._reelSpins.filter((x) => x.col > spin.col && x.phase === 'spin').sort((x, y) => x.col - y.col)) {
            // (stopAt is when a reel STARTS landing; a normal landing itself
            // takes about a stagger, so the next normal reel may go right away)
            const want = prev + (o.antic ? o.antic.seconds : 0)
            if (o.stopAt < want) o.stopAt = want
            if (o.antic && first) o.anticStartAt = Math.min(o.anticStartAt, prev)
            if (o.antic) o.anticStartAt = Math.max(o.anticStartAt, o.stopAt - o.antic.seconds)
            prev = o.stopAt + (o.antic ? this.anticipationLandSeconds : this.spinStaggerSeconds)
            first = false
        }
        const more = this._reelSpins.some((o) => o.col > spin.col && o.antic && o.phase !== 'settle')
        if (more) this._setDim(true, spin.col + 1)
        else this._setDim(false)
    }

    // Dims every reel left of `uptoCol` (on), or brightens the whole board.
    _setDim(on, uptoCol = 0) {
        const sm = this.slotManager
        if (!sm) return
        if (!on && !this._dimmed) return
        this._dimmed = on
        this._dimReels = new Set()
        const host = this._reelsHost()
        for (let c = 0; c < sm.cols; c++) {
            const reel = host.transform.children.find((r) => r.name === sm.reelName(c))
            if (!reel) continue
            if (on && c < uptoCol) this._dimReels.add(reel)
            // reels still spinning get their opacity from _setReelBlur each frame
            if (this._reelSpins.some((o) => o.col === c && o.phase === 'spin')) continue
            for (const sym of reel.transform.children) {
                const sr = sym.getComponent('spriteRenderer')
                if (!sr) continue
                const t = sym.transform
                if (!this._baseOpacity.has(t)) this._baseOpacity.set(t, sr.opacity)
                sr.opacity = this._baseOpacity.get(t) * this._dimFactor(sym)
            }
        }
    }

    // How bright this symbol is drawn right now (dimmed during anticipation).
    _dimFactor(symbol) {
        if (!this._dimmed || !this._dimReels) return 1
        return this._dimReels.has(symbol.transform.parent) ? Math.max(0, Math.min(1, this.anticipationDim)) : 1
    }

    // The copy of anticipationEffect sitting on reel `col` (made the first
    // time it's needed when `make`), or null without an effect.
    _effectFor(col, make = true) {
        if (!this.anticipationEffect) return null
        if (!this._effects) this._effects = new Map()
        let fx = this._effects.get(col)
        if (fx || !make) return fx || null
        const sm = this.slotManager
        const host = this._reelsHost()
        const reel = host.transform.children.find((r) => r.name === sm.reelName(col))
        if (!reel) return null
        fx = Lite.instantiate(this.anticipationEffect, null, null, host)
        if (!fx) return null
        fx.name = 'AnticipationFx_' + col
        fx.transform.x = reel.transform.x
        fx.transform.y = reel.transform.y
        fx.active = false
        this._effects.set(col, fx)
        return fx
    }

    // A gentle pulse on the effect while its reel waits.
    _pulseEffect(spin) {
        const fx = this._effects && this._effects.get(spin.col)
        if (!fx) return
        const t = fx.transform
        if (!this._baseScale.has(t)) this._baseScale.set(t, { x: t.scaleX, y: t.scaleY })
        const base = this._baseScale.get(t)
        const k = 1 + 0.04 * Math.sin(spin.elapsed * 10)
        t.scaleX = base.x * k
        t.scaleY = base.y * k
    }

    // Every time the strip has scrolled one more whole symbol, one symbol
    // (the one that just left the bottom) comes back in at the top and
    // needs something to show. While the real result isn't being scrolled
    // in yet that is a random symbol; during the landing it is the real
    // board, last row first -- so the symbols the player sees rolling into
    // place are the symbols they stop on, and nothing changes at the end.
    _feedSteps(spin) {
        const sm = this.slotManager
        const rows = sm.rows
        const count = rows + 1
        // A non-finite scroll position (a zero spacing, say) must never reach the
        // loop below: Infinity would never be caught up to and freeze the page.
        if (!Number.isFinite(spin.u)) spin.u = spin.step
        const target = Math.floor(spin.u + 1e-9)
        while (spin.step < target) {
            spin.step++
            const cell = spin.cells[(count - (spin.step % count)) % count]
            let symbolId = null
            if (spin.phase === 'land') {
                const row = spin.landU - 1 - spin.step
                if (row >= 0 && row < rows) symbolId = sm.getBoardSymbol(spin.col, row)
            }
            if (symbolId == null && sm.symbols.length) {
                symbolId = sm.symbols[Math.floor(Math.random() * sm.symbols.length)].symbolId
            }
            if (symbolId != null) sm.applySymbolToObject(cell, symbolId)
            // The symbol entering after the last real row is the one that
            // sits hidden above the reel once it has stopped.
            if (spin.phase === 'land' && spin.step === spin.landU) spin.topId = symbolId
        }
    }

    // Lays the whole reel out from its single scroll position. Slot p
    // (0 = hidden just above the window, 1..rows = the visible rows) is
    // p symbols below the top; a symbol that scrolls past the bottom of the
    // window re-enters at p = 0, where it is also completely out of
    // sight, so the wrap itself can never be seen.
    _placeReel(spin) {
        const sm = this.slotManager
        const spacing = (Number(sm.symbolSpacing) || 1)
        const count = sm.rows + 1
        const topY = ((sm.rows - 1) / 2 + 1) * spacing
        const blurT = this.reelBlur ? Math.min(1, Math.max(0, spin.speed / this.spinScrollSpeed)) : 0
        spin.cells.forEach((cell, i) => {
            const slot = (i + spin.u) % count
            cell.transform.y = topY - slot * spacing
            this._setReelBlur(cell, blurT)
        })
    }

    // Puts the reel on its grid: each Symbol_N at its own row, the spare
    // above the window. When `showBoard` is set, each one also gets the real
    // symbol for its row. At that moment the strip is exactly on the grid
    // with the real board scrolled into place, so this swaps which object is
    // standing where without changing what is drawn. `offset` shifts the
    // whole reel (the settle bounce).
    _restReel(spin, showBoard = false, offset = 0) {
        const sm = this.slotManager
        const spacing = (Number(sm.symbolSpacing) || 1)
        const topY = ((sm.rows - 1) / 2 + 1) * spacing
        const [spare, ...rows] = spin.cells
        rows.forEach((symbol, row) => {
            // its resting spot (where Slot Manager places win lines too)
            const rest = sm.cellRestLocal ? sm.cellRestLocal(spin.col, row) : { y: ((sm.rows - 1) / 2 - row) * spacing }
            symbol.transform.y = rest.y + offset
            if (rest.x !== undefined) symbol.transform.x = rest.x
            this._setReelBlur(symbol, 0)
            if (showBoard) {
                const real = sm.getBoardSymbol(spin.col, row)
                if (real != null) sm.applySymbolToObject(symbol, real)
            }
        })
        spare.transform.y = topY + offset
        this._setReelBlur(spare, 0)
        if (showBoard && spin.topId != null) sm.applySymbolToObject(spare, spin.topId)
    }

    // Stretches this ONE symbol vertically and fades it, by `t` (0 = its
    // own normal resting scale/opacity, 1 = full reelBlurStretch/
    // reelBlurOpacity) -- a cheap, common slot-machine trick for reading
    // as motion blur without an actual image blur. Captures the
    // symbol's real resting values the first time it's ever touched
    // (see _baseScale/_baseOpacity above), the same way _punch() does,
    // so this always eases back to what the symbol was actually
    // authored at, not an assumed 1.
    _setReelBlur(symbol, t) {
        const transform = symbol.transform
        if (!this._baseScale.has(transform)) {
            this._baseScale.set(transform, { x: transform.scaleX, y: transform.scaleY })
        }
        const baseScale = this._baseScale.get(transform)
        transform.scaleY = baseScale.y * (1 + (this.reelBlurStretch - 1) * t)

        const sr = symbol.getComponent('spriteRenderer')
        if (!sr) return
        if (!this._baseOpacity.has(transform)) this._baseOpacity.set(transform, sr.opacity)
        const baseOpacity = this._baseOpacity.get(transform)
        sr.opacity = baseOpacity * (1 - (1 - this.reelBlurOpacity) * t) * this._dimFactor(symbol)
    }

    // Lights up the pooled WinLine_N GameObjects createSlotHUD builds
    // (see its own comment on why they're pre-built rather than created
    // here a script can't construct a new Component at runtime) with
    // each winning line's actual shape, converting {reel,row} cell
    // positions into the same local-space coordinates Slot Manager's own
    // reels/symbols sit at. Every pooled line not used by this win is
    // explicitly hidden first, so a smaller win never leaves a stale
    // line from a bigger previous one still showing.
    // Each point is the centre of a winning cell exactly where the player
    // sees it (Slot Manager's winLinePoints: the reel's real position, the
    // Reels Object, a Fit Area warp, a moved or scaled HUD), turned into the
    // line's own space - so the line sits on the symbols wherever the board
    // or the WinLines object is. Re-placed every frame while showing, so it
    // stays on them if the layout changes (the screen is turned, resized).
    _drawWinLines(lines) {
        const container = this._findDescendant(this.gameObject, 'WinLines')
        if (!container) return
        const pool = container.transform.children
        for (const lineGO of pool) lineGO.active = false
        // more winning lines than pooled line objects: copy one for each extra
        while (pool.length && pool.length < lines.length) {
            const copy = Lite.instantiate(pool[0], null, null, container)
            if (!copy) break
            copy.name = 'WinLine_' + (pool.length - 1)
            copy.active = false
        }
        this._shownLines = []
        lines.forEach((line, i) => {
            const lineGO = pool[i]
            const lr = lineGO?.getComponent('lineRenderer')
            if (!lr || !line?.positions?.length) return
            lr.color = this.winLineColor
            lr.width = this.winLineWidth
            this._shownLines.push({ lineGO, lr, positions: line.positions })
        })
        this._placeWinLines()
    }

    _placeWinLines() {
        const sm = this.slotManager
        for (const shown of this._shownLines || []) {
            const points = sm.winLinePoints
                ? sm.winLinePoints(shown.lineGO, shown.positions)
                : shown.positions.map((p) => ({ x: (p.reel - (sm.cols - 1) / 2) * sm.reelSpacing, y: ((sm.rows - 1) / 2 - p.row) * (Number(sm.symbolSpacing) || 1) }))
            shown.lr.points = points
            shown.lineGO.active = points.length >= 2
        }
    }

    _hideWinLines() {
        this._shownLines = []
        const container = this._findDescendant(this.gameObject, 'WinLines')
        if (!container) return
        for (const lineGO of container.transform.children) lineGO.active = false
    }

    // A plain by-name search through the whole subtree, not just direct
    // children WinLines sits under SlotHUD, itself a child of the
    // GameObject this script is actually on, so a direct-children lookup
    // (like reelName()/symbolName() use, which only ever look one level
    // down into a known reel) wouldn't find it.
    _findDescendant(root, name) {
        for (const child of root.transform.children) {
            if (child.name === name) return child
            const found = this._findDescendant(child, name)
            if (found) return found
        }
        return null
    }

    // Where the Reel_N reels are: the Slot Manager's Reels Object, or (when the
    // reels were put under another GameObject) wherever it finds them, else
    // this GameObject.
    _reelsHost() {
        const sm = this.slotManager
        return (sm && sm.reelHost ? sm.reelHost() : null) || this.gameObject
    }

    _punchCell(col, row) {
        if (col == null || row == null) return
        const sm = this.slotManager
        const reel = this._reelsHost().transform.children.find((c) => c.name === sm.reelName(col))
        const symbol = reel?.transform.children.find((c) => c.name === sm.symbolName(row))
        if (symbol) this._punch(symbol.transform, this.winPunchScale, this.winPunchSeconds)
    }

    _punchBoard(scale, seconds) {
        const sm = this.slotManager
        for (let c = 0; c < sm.cols; c++) {
            const reel = this._reelsHost().transform.children.find((ch) => ch.name === sm.reelName(c))
            if (!reel) continue
            for (let r = 0; r < sm.rows; r++) {
                const symbol = reel.transform.children.find((ch) => ch.name === sm.symbolName(r))
                if (symbol) this._punch(symbol.transform, scale, seconds)
            }
        }
    }

    _punch(transform, scale, seconds) {
        if (!this._baseScale.has(transform)) {
            this._baseScale.set(transform, { x: transform.scaleX, y: transform.scaleY })
        }
        const base = this._baseScale.get(transform)
        this._flashes = this._flashes.filter((f) => f.transform !== transform)
        this._flashes.push({ transform, baseScaleX: base.x, baseScaleY: base.y, punch: scale, duration: seconds, elapsed: 0 })
    }

    _setBannerActive(banner, active) {
        if (!banner) return
        banner.active = active
    }

    _setBannerText(banner, text) {
        if (!banner) return
        const tr = banner.getComponent('textRenderer')
        if (tr) tr.text = text
    }

}
