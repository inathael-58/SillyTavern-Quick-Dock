/*
 * Quick Dock — SillyTavern UI extension
 *
 * One floating button instead of many. Tapping it opens
 *   • shortcuts — fanned out in an arc around the button (thumb reach), or in
 *     a grid. A shortcut is either a built-in jump (top message, latest
 *     message, latest bot reply) or any SillyTavern button, recorded by
 *     long-pressing it once; if that button lives inside a closed menu, the
 *     taps that opened the menu are replayed first;
 *   • a tray card — other extensions' floating buttons, moved in so they stop
 *     covering the chat (they keep working and keep their status).
 */

const MODULE = 'quick_dock';
const LOG = '[QuickDock]';
const EDGE_MARGIN = 8;       // px between our UI and the screen edge
const LONG_PRESS_MS = 550;
const MOVE_TOLERANCE = 10;   // px a finger may wobble during a long press
const MAX_PATH = 3;          // menu-opening taps remembered per shortcut

// Arc geometry
const ARC_LABEL = 14;        // px, label height under a button
const ARC_LABEL_W = 64;      // px, widest a label may get
const ARC_REACH = 210;       // px from the launcher's centre; beyond this the thumb stops reaching — the rest go into the card
const ARC_MAX_RINGS = 4;

const DEFAULTS = Object.freeze({
    enabled: true,
    layout: 'arc',                   // 'arc' | 'grid'
    labelMode: 'show',               // 'show' | 'hide' | 'edit' (only while editing)
    size: 46,                        // launcher diameter
    itemSize: 46,                    // shortcut button diameter
    iconScale: 42,                   // icon size, % of its button
    iconColor: 'body',               // see COLOR_SOURCES
    bgColor: 'tint',
    borderColor: 'border',
    accentColor: 'quote',
    customColors: Object.freeze({ icon: '#ffffff', bg: '#1e1e28', border: '#777777', accent: '#e18a24' }),
    bgOpacity: 85,                   // % — button backgrounds
    idleOpacity: 100,                // % — launcher while the dock is closed
    blur: false,                     // backdrop blur (costs GPU)
    shadow: true,
    fx: 'ring',                      // hover/press effect, see FX
    icon: 'fa-solid fa-bolt',
    columns: 4,
    closeOnShortcut: true,
    closeOnTray: true,
    statusDot: true,
    pickbarBottom: false,
    builtinsSeeded: false,
    pos: Object.freeze({ x: 1, y: 0.8, edge: 'right' }),
    shortcuts: Object.freeze([]),    // { id, label, icon, sel, path } | { id, label, icon, builtin }
    tray: Object.freeze([]),         // { id, label, sel }
});

const COLOR_SOURCES = Object.freeze({
    body: ['ตัวอักษรหลัก (Main Text)', '--SmartThemeBodyColor'],
    em: ['ตัวเอียง (Italics)', '--SmartThemeEmColor'],
    underline: ['ขีดเส้นใต้ (Underline)', '--SmartThemeUnderlineColor'],
    quote: ['คำพูด (Quote)', '--SmartThemeQuoteColor'],
    tint: ['พื้นเบลอ (UI Background)', '--SmartThemeBlurTintColor'],
    chat: ['พื้นแชท (Chat Background)', '--SmartThemeChatTintColor'],
    border: ['ขอบ (UI Border)', '--SmartThemeBorderColor'],
    shadow: ['เงา (Shadow)', '--SmartThemeShadowColor'],
    custom: ['กำหนดเอง…', null],
});

// Hover (mouse) / press (touch) effects — only colour, outline or transform changes: no blur, no animated shadows.
const FX = Object.freeze({
    none: 'ไม่มี',
    ring: 'วงแหวนรอบปุ่ม',
    border: 'ขอบและไอคอนเปลี่ยนสี',
    tint: 'พื้นปุ่มอมสีเน้น',
    grow: 'ขยายขึ้นเล็กน้อย',
    press: 'ยุบลงตอนกด',
    lift: 'ลอยขึ้นเล็กน้อย',
});

const BUILTINS = Object.freeze({
    top: { label: 'บนสุด', icon: 'fa-solid fa-angles-up', hint: 'ข้อความแรกของแชท' },
    last: { label: 'ล่าสุด', icon: 'fa-solid fa-angles-down', hint: 'ต้นข้อความล่าสุด' },
    lastBot: { label: 'บอทตอบ', icon: 'fa-solid fa-robot', hint: 'ต้นข้อความล่าสุดที่บอทตอบ' },
});

const ICONS = [
    '⚡', '✨', '🌙', '🌸', '🍀', '🐱', '🐾', '💜', '🔮', '📖', '🎲', '☕',
    'fa-solid fa-bolt', 'fa-solid fa-star', 'fa-solid fa-heart', 'fa-solid fa-bars', 'fa-solid fa-grip',
    'fa-solid fa-layer-group', 'fa-solid fa-wand-magic-sparkles', 'fa-solid fa-feather', 'fa-solid fa-pen-nib',
    'fa-solid fa-book', 'fa-solid fa-book-open', 'fa-solid fa-book-atlas', 'fa-solid fa-scroll', 'fa-solid fa-bookmark',
    'fa-solid fa-comment', 'fa-solid fa-comments', 'fa-solid fa-robot', 'fa-solid fa-user', 'fa-solid fa-face-smile',
    'fa-solid fa-cat', 'fa-solid fa-paw', 'fa-solid fa-dragon', 'fa-solid fa-ghost', 'fa-solid fa-moon',
    'fa-solid fa-sun', 'fa-solid fa-cloud', 'fa-solid fa-leaf', 'fa-solid fa-seedling', 'fa-solid fa-fire',
    'fa-solid fa-snowflake', 'fa-solid fa-gem', 'fa-solid fa-crown', 'fa-solid fa-dice', 'fa-solid fa-puzzle-piece',
    'fa-solid fa-gamepad', 'fa-solid fa-music', 'fa-solid fa-image', 'fa-solid fa-palette', 'fa-solid fa-sliders',
    'fa-solid fa-gear', 'fa-solid fa-plug', 'fa-solid fa-globe', 'fa-solid fa-magnifying-glass', 'fa-solid fa-rotate-right',
    'fa-solid fa-floppy-disk', 'fa-solid fa-clock-rotate-left', 'fa-solid fa-angles-up', 'fa-solid fa-angles-down',
    'fa-solid fa-reply', 'fa-solid fa-paper-plane', 'fa-solid fa-trash', 'fa-solid fa-circle-dot',
];

// ---------------------------------------------------------------- helpers

const ctx = () => SillyTavern.getContext();

function settings() {
    const ext = ctx().extensionSettings;
    if (!ext[MODULE]) ext[MODULE] = {};
    const s = ext[MODULE];
    if (s.labelMode === undefined && s.showLabels === false) s.labelMode = 'hide'; // 1.1 setting
    delete s.showLabels;
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s[k] === undefined) s[k] = Array.isArray(v) ? [] : (v && typeof v === 'object') ? { ...v } : v;
    }
    if (!Array.isArray(s.shortcuts)) s.shortcuts = [];
    if (!Array.isArray(s.tray)) s.tray = [];
    s.customColors = { ...DEFAULTS.customColors, ...(s.customColors || {}) };
    if (!s.builtinsSeeded) {
        s.builtinsSeeded = true;
        const add = Object.keys(BUILTINS).filter(b => !s.shortcuts.some(x => x.builtin === b));
        s.shortcuts.unshift(...add.map(b => ({ id: `b_${b}`, builtin: b, label: BUILTINS[b].label, icon: BUILTINS[b].icon })));
    }
    return s;
}

const save = () => ctx().saveSettingsDebounced();

const toast = {
    ok: m => globalThis.toastr?.success(m, 'Quick Dock'),
    info: m => globalThis.toastr?.info(m, 'Quick Dock'),
    warn: m => globalThis.toastr?.warning(m, 'Quick Dock'),
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const newId = p => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const wait = ms => new Promise(r => setTimeout(r, ms));

/** Layout viewport — does not shrink when the on-screen keyboard opens, so the launcher stays put. */
function viewportSize() {
    const de = document.documentElement;
    return { vw: de.clientWidth || window.innerWidth, vh: de.clientHeight || window.innerHeight };
}

/** The part of the page actually visible right now (above the keyboard), in fixed-position coordinates. */
function visibleArea() {
    const vv = window.visualViewport;
    const { vw, vh } = viewportSize();
    return vv ? { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height } : { x: 0, y: 0, w: vw, h: vh };
}

/** Font Awesome classes → <i>; anything else (emoji, a letter) → text. */
function iconHTML(icon) {
    const v = String(icon ?? '').trim();
    if (/(^|\s)fa-/.test(v)) return `<i class="${esc(v)}"></i>`;
    return `<span class="qd_emoji">${esc(v || '•')}</span>`;
}

function cleanIcon(v) {
    v = String(v ?? '').trim();
    if (/(^|\s)fa-/.test(v)) return v.replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ');
    return v.slice(0, 8);
}

const iconGridHTML = () => ICONS.map(ic => `<div class="qd_ic" role="button" tabindex="0" data-icon="${esc(ic)}" title="${esc(ic)}">${iconHTML(ic)}</div>`).join('');

// ---------------------------------------------------------------- finding elements

const OWN = '#qd_launcher, #qd_panel, #qd_arc, #qd_pickbar, #qd_hl';
const isOwn = el => !!el?.closest?.(OWN);

function isShown(el) {
    if (!el?.isConnected || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
}

function queryAll(sel) {
    try { return [...document.querySelectorAll(sel)]; } catch { return []; }
}
const queryShown = sel => queryAll(sel).find(el => !isOwn(el) && isShown(el)) ?? null;

// Classes that come and go with UI state make poor selectors.
const STATES = 'open|opened|close|closed|active|selected|hover|focus|focused|hidden|displaynone|visible|show|shown|toggled|disabled|checked|expanded|collapsed|dragging|pinned';
const STATE_CLASS = new RegExp(`^(${STATES})|(${STATES})$|^qd_|^cab_dragging$`, 'i');
const unique = sel => queryAll(sel).length === 1;
const cssStr = v => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * A CSS selector that finds `el` again after a reload. With `structural:false`
 * only id/class/attribute selectors are tried (needed for tray items, which we
 * move around the DOM) and null is returned when none is unique.
 */
function buildSelector(el, { structural = true } = {}) {
    const tag = el.tagName.toLowerCase();
    if (el.id && unique(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;
    for (const a of ['data-i18n', 'title', 'aria-label', 'name', 'data-id', 'data-action', 'data-type']) {
        const v = el.getAttribute(a);
        if (v && v.length < 120) {
            const s = `${tag}[${a}="${cssStr(v)}"]`;
            if (unique(s)) return s;
        }
    }
    const cls = [...el.classList].filter(c => !STATE_CLASS.test(c)).map(c => `.${CSS.escape(c)}`).join('');
    if (cls && unique(tag + cls)) return tag + cls;
    if (!structural) return null;

    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur.parentElement && parts.length < 10) {
        if (cur !== el && cur.id && unique(`#${CSS.escape(cur.id)}`)) {
            parts.unshift(`#${CSS.escape(cur.id)}`);
            return parts.join(' > ');
        }
        const t = cur.tagName.toLowerCase();
        const same = [...cur.parentElement.children].filter(c => c.tagName === cur.tagName);
        parts.unshift(same.length > 1 ? `${t}:nth-of-type(${same.indexOf(cur) + 1})` : t);
        cur = cur.parentElement;
    }
    return `body > ${parts.join(' > ')}`;
}

const CLICKABLE = 'button, a, input, select, label, [role="button"], [role="menuitem"], [onclick], .menu_button, .interactable, .list-group-item, .drawer-toggle, .drawer-icon, .mes_button, .right_menu_button';

/** The element a tap on `t` is really aimed at. */
function clickableOf(t) {
    const el = t.closest(CLICKABLE) ?? t;
    return isOwn(el) || el === document.body || el === document.documentElement ? null : el;
}

const CORE = '#top-bar, #top-settings-holder, #sheld, #chat, #form_sheld, #send_form, #leftNavPanel, #rightNavPanel, #movingDivs, #toast-container, #bg1, #bg_custom, .drawer-content, dialog, .popup';

/** The floating container around `t` (what an extension positioned on screen), or null. */
function floatingRootOf(t) {
    const { vw, vh } = viewportSize();
    let absolute = null;
    for (let el = t; el && el !== document.body; el = el.parentElement) {
        if (isOwn(el)) return null;
        const pos = getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') {
            const r = el.getBoundingClientRect();
            if (el.matches(CORE) || (r.width > vw * 0.6 && r.height > vh * 0.4)) return absolute;
            return el;
        }
        if (pos === 'absolute' && !absolute) {
            const r = el.getBoundingClientRect();
            if (!el.matches(CORE) && r.width <= Math.max(160, vw * 0.5) && r.height <= Math.max(160, vh * 0.3)) absolute = el;
        }
    }
    return absolute;
}

/** Small fixed-position elements that look like floating buttons. */
function scanFloating() {
    const { vw, vh } = viewportSize();
    const out = [];
    const visit = (parent, depth) => {
        for (const c of parent.children) {
            if (isOwn(c) || c.matches('script, style, link, template, #chat, #bg1, #bg_custom, #toast-container')) continue;
            if (c.dataset.qdTray) continue;
            const cs = getComputedStyle(c);
            if (cs.display === 'none') continue;
            if (cs.position === 'fixed' && isShown(c) && !c.matches(CORE)) {
                const r = c.getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && r.width <= Math.max(160, vw * 0.5) && r.height <= Math.max(160, vh * 0.3)) {
                    out.push(c);
                    continue;
                }
            }
            if (depth < 3) visit(c, depth + 1);
        }
    };
    visit(document.body, 0);
    return out;
}

function labelOf(el) {
    const t = el.getAttribute('title') || el.getAttribute('aria-label') || el.dataset?.tooltip || el.innerText || el.value || '';
    const s = String(t).replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, 28) : 'ปุ่ม';
}

const FA_STYLE = /^fa-(solid|regular|brands|light|thin|duotone)$/;
const FA_SKIP = /^fa-(fw|lg|xl|xs|sm|2xs|2xl|\dx|spin|spin-pulse|pulse|beat|beat-fade|fade|bounce|flip|shake|border|inverse|pull-left|pull-right|stack|stack-1x|stack-2x|width-auto)$/;

/** Font Awesome icon classes on or inside `el`, e.g. "fa-solid fa-sliders". */
function iconOf(el) {
    const from = e => {
        if (!e) return null;
        const fa = [...e.classList].filter(c => c.startsWith('fa-') && !FA_SKIP.test(c));
        const name = fa.find(c => !FA_STYLE.test(c));
        if (!name) return null;
        const style = fa.find(c => FA_STYLE.test(c)) ?? (e.classList.contains('far') ? 'fa-regular' : e.classList.contains('fab') ? 'fa-brands' : 'fa-solid');
        return `${style} ${name}`;
    };
    return from(el) ?? from(el.querySelector('[class*="fa-"]')) ?? 'fa-solid fa-circle-dot';
}

// ---------------------------------------------------------------- UI skeleton

let launcher = null;
let panel = null;         // the card: tray, editor, add menu, bar (+ grid in grid layout)
let arc = null;           // shortcut buttons fanned around the launcher
let editing = false;
let edit = null;          // { kind: 'sc' | 'tray' | 'launcher', id }
let arcSlots = [];        // [{ x, y }] centres of the arc buttons, in shortcut order
const slots = new Map();  // tray id -> slot element
const live = new Map();   // tray id -> { el, home: { parent, next }, obs }

const isOpen = () => !!panel?.classList.contains('qd_open');

function buildUI() {
    launcher = document.createElement('div');
    launcher.id = 'qd_launcher';
    launcher.setAttribute('role', 'button');
    launcher.tabIndex = 0;
    launcher.title = 'Quick Dock — แตะเพื่อเปิด · ลากเพื่อย้าย · กดค้างเพื่อเปลี่ยนไอคอน';
    launcher.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); } });
    makeDraggable(launcher, {
        onTap: () => (pick ? endPick() : togglePanel()), // during pick mode: cancel
        onLong: () => { if (pick) return; openPanel(); setEditing(true); openEditor('launcher', null); },
    });

    arc = document.createElement('div');
    arc.id = 'qd_arc';
    arc.addEventListener('click', e => {
        const item = e.target.closest('.qd_arc_item');
        if (item) onShortcutTap(item.dataset.id);
    });

    panel = document.createElement('div');
    panel.id = 'qd_panel';
    panel.innerHTML = `
        <div class="qd_tray"></div>
        <div class="qd_grid"></div>
        <div class="qd_hint"></div>
        <div class="qd_addmenu">
            <div class="qd_addbtn" data-add="pick" role="button" tabindex="0"><i class="fa-solid fa-crosshairs"></i> เลือกปุ่มบนจอ (กดค้าง)</div>
            ${Object.entries(BUILTINS).map(([k, b]) => `<div class="qd_addbtn" data-add="${k}" role="button" tabindex="0">${iconHTML(b.icon)} ${esc(b.hint)}</div>`).join('')}
        </div>
        <div class="qd_editor">
            <div class="qd_ed_title"></div>
            <input type="text" class="text_pole qd_ed_label" placeholder="ชื่อ" enterkeyhint="done">
            <div class="qd_ed_iconrow">
                <span class="qd_ed_iconprev"></span>
                <input type="text" class="text_pole qd_ed_icon" placeholder="อีโมจิ หรือ fa-solid fa-star" enterkeyhint="done">
            </div>
            <div class="qd_icongrid">${iconGridHTML()}</div>
            <div class="qd_ed_btns">
                <div class="menu_button qd_ed_left" title="เลื่อนไปก่อน"><i class="fa-solid fa-arrow-left"></i></div>
                <div class="menu_button qd_ed_right" title="เลื่อนไปหลัง"><i class="fa-solid fa-arrow-right"></i></div>
                <div class="menu_button qd_ed_rebind" title="ผูกกับปุ่มอื่น"><i class="fa-solid fa-crosshairs"></i></div>
                <div class="menu_button qd_ed_del"></div>
                <div class="menu_button qd_ed_done" title="เสร็จ"><i class="fa-solid fa-check"></i></div>
            </div>
        </div>
        <div class="qd_bar">
            <div class="qd_barbtn" data-act="add-sc" role="button" tabindex="0" title="เพิ่มช็อตคัท"><i class="fa-solid fa-plus"></i><span>ช็อตคัท</span></div>
            <div class="qd_barbtn" data-act="add-tray" role="button" tabindex="0" title="เก็บปุ่มลอยของ extension อื่นเข้า dock"><i class="fa-solid fa-inbox"></i><span>ปุ่มลอย</span></div>
            <div class="qd_barbtn qd_launcherbtn" data-act="launcher-icon" role="button" tabindex="0" title="เปลี่ยนไอคอนปุ่มหลัก"><span class="qd_launcherprev"></span><span>ปุ่มหลัก</span></div>
            <div class="qd_barbtn qd_editbtn" data-act="edit" role="button" tabindex="0" title="แก้ไข / จัดลำดับ / ลบ"><i class="fa-solid fa-pen"></i></div>
        </div>`;

    panel.querySelector('.qd_grid').addEventListener('click', e => {
        const item = e.target.closest('.qd_sc');
        if (item) onShortcutTap(item.dataset.id);
    });
    panel.querySelector('.qd_tray').addEventListener('click', e => {
        const slot = e.target.closest('.qd_slot');
        if (!slot) return;
        if (editing) { openEditor('tray', slot.dataset.id); return; }
        if (settings().closeOnTray) setTimeout(closePanel, 0); // after the button's own handler
    });
    panel.querySelector('.qd_bar').addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'add-sc') toggleAddMenu();
        if (act === 'add-tray') startPick('tray');
        if (act === 'edit') setEditing(!editing);
        if (act === 'launcher-icon') openEditor('launcher', null);
    });
    panel.querySelector('.qd_addmenu').addEventListener('click', e => {
        const add = e.target.closest('[data-add]')?.dataset.add;
        if (!add) return;
        panel.querySelector('.qd_addmenu').classList.remove('qd_show');
        if (add === 'pick') { startPick('sc'); return; }
        const s = settings();
        if (!s.shortcuts.some(x => x.builtin === add)) {
            s.shortcuts.unshift({ id: newId('b'), builtin: add, label: BUILTINS[add].label, icon: BUILTINS[add].icon });
            save();
            renderSettingsLists();
        }
        renderPanel();
    });
    wireEditor();

    // Keep the card above the on-screen keyboard while a field is being edited.
    panel.addEventListener('focusin', () => setTimeout(placePanel, 60));
    panel.addEventListener('focusout', () => setTimeout(placePanel, 120));

    document.body.append(launcher, arc, panel);

    // Close when tapping elsewhere.
    document.addEventListener('pointerdown', e => {
        if (!isOpen()) return;
        if (panel.contains(e.target) || launcher.contains(e.target) || arc.contains(e.target)) return;
        if (e.target.closest?.('#qd_settings')) return; // live preview while adjusting the look
        closePanel();
    }, true);
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (pick) endPick();
        else if (isOpen()) closePanel();
    });

    const reflow = () => {
        placeLauncher();
        if (!isOpen()) return;
        if (isTyping()) placePanel(); else renderPanel();
    };
    window.addEventListener('resize', reflow);
    window.visualViewport?.addEventListener('resize', reflow);
    window.visualViewport?.addEventListener('scroll', () => { if (isOpen() && isTyping()) placePanel(); });
}

function colorValue(key, which) {
    const s = settings();
    if (key === 'custom') return s.customColors[which] || DEFAULTS.customColors[which];
    const v = COLOR_SOURCES[key]?.[1];
    return v ? `var(${v})` : null;
}

const itemSize = () => clamp(Number(settings().itemSize) || DEFAULTS.itemSize, 30, 80);
const labelsVisible = () => { const m = settings().labelMode; return m === 'show' || (m === 'edit' && editing); };

function applyLook() {
    const s = settings();
    const root = document.documentElement;
    const set = (k, v) => root.style.setProperty(k, v);
    set('--qd-fg', colorValue(s.iconColor, 'icon') ?? 'var(--SmartThemeBodyColor)');
    set('--qd-bg', colorValue(s.bgColor, 'bg') ?? 'var(--SmartThemeBlurTintColor)');
    set('--qd-border', colorValue(s.borderColor, 'border') ?? 'var(--SmartThemeBorderColor)');
    set('--qd-accent', colorValue(s.accentColor, 'accent') ?? 'var(--SmartThemeQuoteColor)');
    set('--qd-bg-op', `${clamp(Number.isFinite(Number(s.bgOpacity)) ? Number(s.bgOpacity) : 85, 0, 100)}%`);
    set('--qd-idle-op', String(clamp(Number(s.idleOpacity) || 100, 15, 100) / 100));
    set('--qd-item', `${itemSize()}px`);
    set('--qd-icon', String(clamp(Number(s.iconScale) || DEFAULTS.iconScale, 25, 75) / 100));
    for (const k of Object.keys(FX)) root.classList.toggle(`qd-fx-${k}`, s.fx === k);
    root.classList.toggle('qd-blur', !!s.blur);
    root.classList.toggle('qd-noshadow', !s.shadow);

    launcher.style.setProperty('--qd-size', `${clamp(Number(s.size) || DEFAULTS.size, 28, 90)}px`);
    launcher.innerHTML = iconHTML(s.icon || DEFAULTS.icon);
    panel.querySelector('.qd_launcherprev').innerHTML = iconHTML(s.icon || DEFAULTS.icon);
    panel.style.setProperty('--qd-cols', clamp(Number(s.columns) || DEFAULTS.columns, 2, 8));
    launcher.classList.toggle('qd_off', !s.enabled);
    arc.classList.toggle('qd_nolabels', !labelsVisible());
    placeLauncher();
    updateBadge();
}

// ---------------------------------------------------------------- launcher position & drag

function normPos(p) {
    const x = clamp(Number(p?.x), 0, 1), y = clamp(Number(p?.y), 0, 1);
    const edge = ['left', 'right', 'top', 'bottom'].includes(p?.edge) ? p.edge : null;
    return { x: Number.isFinite(x) ? x : 1, y: Number.isFinite(y) ? y : 0.8, edge };
}

function placeLauncher() {
    if (!launcher || launcher.classList.contains('qd_dragging')) return;
    const { vw, vh } = viewportSize();
    const w = launcher.offsetWidth, h = launcher.offsetHeight;
    const travelX = Math.max(0, vw - w - 2 * EDGE_MARGIN);
    const travelY = Math.max(0, vh - h - 2 * EDGE_MARGIN);
    const p = normPos(settings().pos);
    let left = EDGE_MARGIN + p.x * travelX;
    let top = EDGE_MARGIN + p.y * travelY;
    if (p.edge === 'left') left = EDGE_MARGIN;
    if (p.edge === 'right') left = EDGE_MARGIN + travelX;
    if (p.edge === 'top') top = EDGE_MARGIN;
    if (p.edge === 'bottom') top = EDGE_MARGIN + travelY;
    launcher.style.left = `${Math.round(left)}px`;
    launcher.style.top = `${Math.round(top)}px`;
}

function snapLauncher() {
    const { vw, vh } = viewportSize();
    const r = launcher.getBoundingClientRect();
    const dist = { left: r.left, right: vw - r.right, top: r.top, bottom: vh - r.bottom };
    const edge = Object.keys(dist).reduce((a, b) => (dist[b] < dist[a] ? b : a));
    const pos = {
        x: clamp((r.left - EDGE_MARGIN) / Math.max(1, vw - r.width - 2 * EDGE_MARGIN), 0, 1),
        y: clamp((r.top - EDGE_MARGIN) / Math.max(1, vh - r.height - 2 * EDGE_MARGIN), 0, 1),
        edge,
    };
    if (edge === 'left') pos.x = 0;
    if (edge === 'right') pos.x = 1;
    if (edge === 'top') pos.y = 0;
    if (edge === 'bottom') pos.y = 1;
    settings().pos = pos;
    save();
}

function makeDraggable(el, { onTap, onLong }) {
    let start = null;
    let dragged = false;
    let longTimer = null;
    let longFired = false;
    el.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        const r = el.getBoundingClientRect();
        start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, id: e.pointerId };
        dragged = false;
        longFired = false;
        clearTimeout(longTimer);
        longTimer = setTimeout(() => { if (start && !dragged) { longFired = true; navigator.vibrate?.(15); onLong?.(); } }, 600);
        try { el.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    });
    el.addEventListener('pointermove', e => {
        if (!start || e.pointerId !== start.id || longFired) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!dragged && Math.hypot(dx, dy) < 6) return;
        if (!dragged) { clearTimeout(longTimer); closePanel(); }
        dragged = true;
        el.classList.add('qd_dragging');
        const { vw, vh } = viewportSize();
        el.style.left = `${clamp(start.left + dx, 0, Math.max(0, vw - el.offsetWidth))}px`;
        el.style.top = `${clamp(start.top + dy, 0, Math.max(0, vh - el.offsetHeight))}px`;
    });
    const end = e => {
        if (!start || e.pointerId !== start.id) return;
        clearTimeout(longTimer);
        try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        start = null;
        if (longFired) return;
        if (!dragged) { if (e.type === 'pointerup') onTap(); return; }
        el.classList.remove('qd_dragging');
        if (e.type === 'pointerup') snapLauncher();
        placeLauncher();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', e => e.preventDefault());
}

// ---------------------------------------------------------------- open / close / render

function togglePanel() {
    if (isOpen()) closePanel(); else openPanel();
}

function openPanel() {
    if (!settings().enabled) return;
    applyLook();
    panel.classList.add('qd_open');
    arc.classList.add('qd_open');
    launcher.classList.add('qd_active');
    renderPanel();
}

function closePanel() {
    if (!panel) return;
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    panel.classList.remove('qd_open');
    arc.classList.remove('qd_open');
    launcher?.classList.remove('qd_active');
    panel.querySelector('.qd_addmenu').classList.remove('qd_show');
    setEditing(false);
}

function toggleAddMenu() {
    const menu = panel.querySelector('.qd_addmenu');
    const s = settings();
    menu.querySelectorAll('[data-add]').forEach(b => {
        b.hidden = b.dataset.add !== 'pick' && s.shortcuts.some(x => x.builtin === b.dataset.add);
    });
    menu.classList.toggle('qd_show');
    placePanel();
}

function shortcutHTML(sc, cls) {
    const sel = editing && edit?.id === sc.id ? ' qd_sel' : '';
    return `<div class="${cls}${sel}" role="button" tabindex="0" data-id="${esc(sc.id)}" title="${esc(sc.label)}">
        <div class="qd_btnface">${iconHTML(sc.icon || 'fa-solid fa-circle-dot')}</div><span>${esc(sc.label)}</span></div>`;
}

function renderPanel() {
    if (!panel) return;
    const s = settings();
    const useArc = s.layout === 'arc';
    arcSlots = useArc ? computeArcSlots(s.shortcuts.length) : [];
    const inArc = s.shortcuts.slice(0, arcSlots.length);
    const inGrid = s.shortcuts.slice(arcSlots.length); // arc layout: whatever did not fit
    arc.innerHTML = inArc.map(sc => shortcutHTML(sc, 'qd_arc_item')).join('');
    panel.querySelector('.qd_grid').innerHTML = inGrid.map(sc => shortcutHTML(sc, 'qd_sc')).join('');
    renderTray();
    const hint = panel.querySelector('.qd_hint');
    hint.textContent = editing
        ? 'แตะรายการเพื่อแก้ชื่อ ไอคอน ลำดับ หรือลบ'
        : (!s.shortcuts.length && !s.tray.length ? 'ยังว่างอยู่ — กด “ช็อตคัท” หรือ “ปุ่มลอย” ด้านล่าง' : '');
    panel.classList.toggle('qd_editing', editing);
    arc.classList.toggle('qd_editing', editing);
    arc.classList.toggle('qd_nolabels', !labelsVisible());
    placePanel();
}

function setEditing(on) {
    editing = !!on;
    if (!editing) edit = null;
    if (!panel) return;
    panel.classList.toggle('qd_editing', editing);
    arc.classList.toggle('qd_editing', editing);
    if (!editing) panel.querySelector('.qd_editor').classList.remove('qd_show');
    if (isOpen()) renderPanel();
}

function onShortcutTap(id) {
    const sc = settings().shortcuts.find(x => x.id === id);
    if (!sc) return;
    if (editing) openEditor('sc', sc.id); else runShortcut(sc);
}

// ---------------------------------------------------------------- placement

const isTyping = () => !!panel && panel.contains(document.activeElement) && document.activeElement.matches('input:not([type="color"]), textarea');

/**
 * Button centres on rings around the launcher, filling the side that faces
 * the middle of the screen — where the thumb reaches when the launcher sits
 * at the edge the hand holds. Each ring's buttons are centred on that side.
 */
function computeArcSlots(n) {
    if (!n || !launcher) return [];
    const { vw, vh } = viewportSize();
    const l = launcher.getBoundingClientRect();
    const cx = l.left + l.width / 2, cy = l.top + l.height / 2;
    const onRight = cx > vw / 2;
    const item = itemSize();
    const label = labelsVisible() ? ARC_LABEL : 0;
    const half = item / 2;
    // Room for the label under each button, so neither neighbours nor the next ring land on it.
    // (Near a screen edge the label lines up with the button's inner side instead — see placeArc.)
    const span = label ? Math.max(item + label + 10, ARC_LABEL_W + 6) : item + 12;
    const gap = item + (label ? label + 12 : 14);
    const fits = (x, y) => x - half >= EDGE_MARGIN && x + half <= vw - EDGE_MARGIN
        && y - half >= EDGE_MARGIN && y + half + label <= vh - EDGE_MARGIN;
    const out = [];
    for (let ring = 0; out.length < n && ring < ARC_MAX_RINGS; ring++) {
        const R = l.width / 2 + half + 14 + ring * gap;
        if (ring > 0 && R > ARC_REACH) break;
        const step = span / R;
        // Sweep from pointing up, through pointing inward, to pointing down — reads top-to-bottom like the list.
        const candidates = [];
        for (let a = 0; a <= Math.PI + 1e-6; a += step) {
            const theta = onRight ? 1.5 * Math.PI - a : -Math.PI / 2 + a;
            const x = cx + R * Math.cos(theta), y = cy + R * Math.sin(theta);
            if (fits(x, y)) candidates.push({ x, y });
        }
        const m = Math.min(n - out.length, candidates.length);
        const from = Math.floor((candidates.length - m) / 2);
        out.push(...candidates.slice(from, from + m));
    }
    return out;
}

function placeArc() {
    const items = [...arc.children];
    let box = null;
    items.forEach((item, i) => {
        const p = arcSlots[i];
        if (!p) return;
        const size = itemSize(), label = labelsVisible() ? ARC_LABEL : 0;
        item.style.left = `${Math.round(p.x - size / 2)}px`;
        item.style.top = `${Math.round(p.y - size / 2)}px`;
        const halfW = Math.max(size / 2, label ? ARC_LABEL_W / 2 : 0);
        const { vw } = viewportSize();
        const nearRight = label && p.x + halfW > vw - 2, nearLeft = label && p.x - halfW < 2;
        item.classList.toggle('qd_lbl_end', nearRight);
        item.classList.toggle('qd_lbl_start', nearLeft && !nearRight);
        const extra = halfW - size / 2;
        const r = {
            l: p.x - size / 2 - (nearLeft ? 0 : extra), t: p.y - size / 2,
            r: p.x + size / 2 + (nearRight ? 0 : extra), b: p.y + size / 2 + label,
        };
        box = box ? { l: Math.min(box.l, r.l), t: Math.min(box.t, r.t), r: Math.max(box.r, r.r), b: Math.max(box.b, r.b) } : r;
    });
    return box;
}

function placePanel() {
    if (!isOpen()) return;
    const s = settings();
    const typing = isTyping();
    arc.classList.toggle('qd_hide', typing || s.layout !== 'arc');
    panel.classList.toggle('qd_gridmode', s.layout !== 'arc');
    if (typing) { placeCardAboveKeyboard(); return; }

    const { vw, vh } = viewportSize();
    panel.style.maxWidth = `${vw - 2 * EDGE_MARGIN}px`;
    panel.style.maxHeight = `${vh - 2 * EDGE_MARGIN}px`;
    const l = launcher.getBoundingClientRect();
    const w = panel.offsetWidth, h = panel.offsetHeight, gap = 8;
    const onRight = l.left + l.width / 2 > vw / 2;
    let left, top;

    const box = s.layout === 'arc' ? placeArc() : null;
    if (box) {
        // Card goes beyond the arc, on the launcher's side of the screen, away from the thumb.
        const around = { t: Math.min(box.t, l.top), b: Math.max(box.b, l.bottom) };
        left = onRight ? vw - EDGE_MARGIN - w : EDGE_MARGIN;
        if (around.t - gap - h >= EDGE_MARGIN) top = around.t - gap - h;
        else if (around.b + gap + h <= vh - EDGE_MARGIN) top = around.b + gap;
        else top = around.t - gap - h; // no room: overlap as little as the clamp allows
    } else {
        const roomLeft = l.left - gap - EDGE_MARGIN;
        const roomRight = vw - l.right - gap - EDGE_MARGIN;
        if (roomLeft >= w || roomRight >= w) {
            const goLeft = onRight ? roomLeft >= w : roomRight < w;
            left = goLeft ? l.left - gap - w : l.right + gap;
            top = l.top + l.height / 2 - h / 2;
        } else {
            const below = vh - l.bottom - gap - EDGE_MARGIN;
            const above = l.top - gap - EDGE_MARGIN;
            top = below >= h || below >= above ? l.bottom + gap : l.top - gap - h;
            left = l.left + l.width / 2 - w / 2;
        }
    }
    panel.style.left = `${Math.round(clamp(left, EDGE_MARGIN, Math.max(EDGE_MARGIN, vw - w - EDGE_MARGIN)))}px`;
    panel.style.top = `${Math.round(clamp(top, EDGE_MARGIN, Math.max(EDGE_MARGIN, vh - h - EDGE_MARGIN)))}px`;
}

/** While typing: pin the card to the top of the visible area and scroll the editor into view inside it. */
function placeCardAboveKeyboard() {
    const a = visibleArea();
    panel.style.maxWidth = `${a.w - 2 * EDGE_MARGIN}px`;
    panel.style.maxHeight = `${Math.max(120, a.h - 2 * EDGE_MARGIN)}px`;
    const w = panel.offsetWidth;
    const curLeft = parseFloat(panel.style.left) || 0;
    panel.style.left = `${Math.round(a.x + clamp(curLeft - a.x, EDGE_MARGIN, Math.max(EDGE_MARGIN, a.w - w - EDGE_MARGIN)))}px`;
    panel.style.top = `${Math.round(a.y + EDGE_MARGIN)}px`;
    const field = document.activeElement;
    const ed = panel.querySelector('.qd_editor');
    const target = ed.contains(field) ? field : ed;
    panel.scrollTop = Math.max(0, target.offsetTop - 40);
}

// ---------------------------------------------------------------- editor

function currentEditItem() {
    if (!edit) return null;
    if (edit.kind === 'launcher') return settings();
    const list = edit.kind === 'sc' ? settings().shortcuts : settings().tray;
    return list.find(x => x.id === edit.id) ?? null;
}

function openEditor(kind, id) {
    edit = { kind, id };
    const item = currentEditItem();
    if (!item) return;
    if (!editing) { editing = true; }
    const ed = panel.querySelector('.qd_editor');
    ed.classList.add('qd_show');
    ed.dataset.kind = kind;
    ed.classList.toggle('qd_builtin', !!item.builtin);
    ed.querySelector('.qd_ed_title').textContent = kind === 'launcher' ? 'ไอคอนปุ่มหลัก' : kind === 'tray' ? 'ปุ่มลอยใน dock' : item.builtin ? `ช็อตคัท: ${BUILTINS[item.builtin]?.hint ?? ''}` : 'ช็อตคัท';
    ed.querySelector('.qd_ed_label').value = kind === 'launcher' ? '' : item.label ?? '';
    ed.querySelector('.qd_ed_icon').value = item.icon ?? '';
    ed.querySelector('.qd_ed_iconprev').innerHTML = iconHTML(item.icon);
    const del = ed.querySelector('.qd_ed_del');
    del.innerHTML = kind === 'sc' ? '<i class="fa-solid fa-trash"></i>' : '<i class="fa-solid fa-arrow-up-from-bracket"></i> คืนหน้าจอ';
    del.title = kind === 'sc' ? 'ลบช็อตคัทนี้' : 'เอาปุ่มนี้ออกจาก dock กลับไปลอยบนจอเหมือนเดิม';
    renderPanel();
}

function setIcon(value) {
    const item = currentEditItem();
    if (!item || edit.kind === 'tray') return;
    item.icon = cleanIcon(value) || (edit.kind === 'launcher' ? DEFAULTS.icon : 'fa-solid fa-circle-dot');
    save();
    const ed = panel.querySelector('.qd_editor');
    ed.querySelector('.qd_ed_iconprev').innerHTML = iconHTML(item.icon);
    if (edit.kind === 'launcher') {
        applyLook();
        syncSettingsIcon();
    } else {
        document.querySelectorAll(`#qd_arc [data-id="${CSS.escape(item.id)}"] .qd_btnface, #qd_panel .qd_sc[data-id="${CSS.escape(item.id)}"] .qd_btnface`)
            .forEach(n => { n.innerHTML = iconHTML(item.icon); });
        renderSettingsLists();
    }
}

function wireEditor() {
    const ed = panel.querySelector('.qd_editor');
    ed.querySelector('.qd_ed_label').addEventListener('input', e => {
        const item = currentEditItem();
        if (!item || edit.kind === 'launcher') return;
        item.label = e.target.value.trim() || item.label;
        save();
        document.querySelectorAll(`#qd_arc [data-id="${CSS.escape(item.id)}"] span, #qd_panel .qd_sc[data-id="${CSS.escape(item.id)}"] span, #qd_panel .qd_slot[data-id="${CSS.escape(item.id)}"] .qd_slot_ph`)
            .forEach(n => { n.textContent = item.label; });
    });
    ed.querySelectorAll('input').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); }));
    ed.querySelector('.qd_ed_icon').addEventListener('input', e => setIcon(e.target.value));
    ed.querySelector('.qd_icongrid').addEventListener('click', e => {
        const ic = e.target.closest('[data-icon]')?.dataset.icon;
        if (!ic) return;
        ed.querySelector('.qd_ed_icon').value = ic;
        setIcon(ic);
    });
    const move = d => {
        const list = edit?.kind === 'sc' ? settings().shortcuts : edit?.kind === 'tray' ? settings().tray : null;
        if (!list) return;
        const i = list.findIndex(x => x.id === edit.id);
        const j = i + d;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        save();
        renderPanel();
        renderSettingsLists();
    };
    ed.querySelector('.qd_ed_left').addEventListener('click', () => move(-1));
    ed.querySelector('.qd_ed_right').addEventListener('click', () => move(1));
    ed.querySelector('.qd_ed_rebind').addEventListener('click', () => { if (edit?.kind === 'sc') startPick('sc', edit.id); });
    ed.querySelector('.qd_ed_del').addEventListener('click', () => {
        if (!edit || edit.kind === 'launcher') return;
        if (edit.kind === 'sc') removeShortcut(edit.id); else removeTrayItem(edit.id);
        edit = null;
        ed.classList.remove('qd_show');
        renderPanel();
        renderSettingsLists();
    });
    ed.querySelector('.qd_ed_done').addEventListener('click', () => {
        if (panel.contains(document.activeElement)) document.activeElement.blur();
        edit = null;
        ed.classList.remove('qd_show');
        renderPanel();
    });
}

// ---------------------------------------------------------------- shortcuts

function removeShortcut(id) {
    const s = settings();
    s.shortcuts = s.shortcuts.filter(x => x.id !== id);
    save();
}

async function waitFor(fn, ms) {
    const end = performance.now() + ms;
    for (;;) {
        const v = fn();
        if (v || performance.now() > end) return v;
        await wait(50);
    }
}

/** Scroll the chat so the start of `mes` sits at the top. Re-checked briefly, as images/rendering can shift it. */
function scrollToMessage(mes) {
    const chat = document.getElementById('chat');
    if (!chat || !mes) return;
    const go = () => {
        const top = mes.getBoundingClientRect().top - chat.getBoundingClientRect().top + chat.scrollTop;
        chat.scrollTo({ top: Math.max(0, top - 4), behavior: 'auto' });
    };
    go();
    requestAnimationFrame(go);
    setTimeout(go, 250);
}

async function runBuiltin(kind) {
    const chat = document.getElementById('chat');
    const messages = () => (chat ? [...chat.querySelectorAll(':scope > .mes')] : []);
    let target = null;
    if (kind === 'top') {
        const first = messages()[0];
        if (first && Number(first.getAttribute('mesid')) > 0) {
            // Older messages aren't rendered yet; SillyTavern's /chat-jump loads them first.
            const c = ctx();
            if (typeof c.executeSlashCommandsWithOptions === 'function') {
                await c.executeSlashCommandsWithOptions('/chat-jump 0', { handleParserErrors: true, handleExecutionErrors: true });
                return;
            }
        }
        target = messages()[0];
    } else if (kind === 'last') {
        target = messages().at(-1);
    } else if (kind === 'lastBot') {
        target = messages().filter(m => m.getAttribute('is_user') === 'false' && m.getAttribute('is_system') !== 'true').at(-1);
    }
    if (!target) {
        toast.info(kind === 'lastBot' ? 'ยังไม่มีข้อความที่บอทตอบ' : 'ยังไม่มีข้อความในแชทนี้');
        return;
    }
    scrollToMessage(target);
}

async function runShortcut(sc) {
    if (settings().closeOnShortcut) closePanel();
    if (sc.builtin) { await runBuiltin(sc.builtin); return; }
    let el = queryShown(sc.sel);
    // Target inside a closed menu? Replay the taps that opened it, stopping as soon as it shows.
    for (const step of (el ? [] : sc.path ?? [])) {
        const opener = queryShown(step);
        if (!opener) continue;
        opener.click();
        el = await waitFor(() => queryShown(sc.sel), 500);
        if (el) break;
    }
    el ??= queryAll(sc.sel).find(x => !isOwn(x));
    if (!el) {
        toast.warn(`ไม่พบปุ่ม “${esc(sc.label)}” — เปิดหน้าที่มีปุ่มนั้นก่อน หรือผูกใหม่ในโหมดแก้ไข`);
        return;
    }
    if (el.matches('input[type="text"], textarea')) el.focus(); else el.click();
}

// ---------------------------------------------------------------- tray (adopted floating buttons)

function slotFor(item) {
    let slot = slots.get(item.id);
    if (!slot) {
        slot = document.createElement('div');
        slot.className = 'qd_slot';
        slot.dataset.id = item.id;
        slot.innerHTML = '<span class="qd_slot_ph"></span><div class="qd_slot_cover"></div>';
        slots.set(item.id, slot);
    }
    slot.querySelector('.qd_slot_ph').textContent = item.label;
    return slot;
}

function renderTray() {
    const tray = panel.querySelector('.qd_tray');
    const s = settings();
    for (const [id, slot] of slots) {
        if (!s.tray.some(x => x.id === id)) { release(id); slot.remove(); slots.delete(id); }
    }
    for (const item of s.tray) {
        const slot = slotFor(item);
        slot.classList.toggle('qd_sel', editing && edit?.id === item.id);
        tray.appendChild(slot); // appending in order also re-orders
    }
    syncTray();
}

function adopt(item, el) {
    let rec = live.get(item.id);
    if (!rec || rec.el !== el) {
        rec?.obs?.disconnect();
        rec = { el, home: { parent: el.parentElement, next: el.nextSibling }, obs: null };
        rec.obs = new MutationObserver(() => { updateBadge(); updateTrayVisibility(); });
        rec.obs.observe(el, { attributes: true, attributeFilter: ['data-state', 'class', 'hidden', 'style'] });
        live.set(item.id, rec);
    }
    el.dataset.qdTray = item.id;
    const slot = slotFor(item);
    slot.insertBefore(el, slot.querySelector('.qd_slot_cover'));
}

function release(id) {
    const rec = live.get(id);
    if (!rec) return;
    rec.obs?.disconnect();
    live.delete(id);
    const { el, home } = rec;
    delete el.dataset.qdTray;
    if (el.isConnected && slots.get(id)?.contains(el)) {
        const parent = home.parent?.isConnected && !isOwn(home.parent) ? home.parent : document.body;
        const next = home.next?.parentNode === parent ? home.next : null;
        parent.insertBefore(el, next);
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 0); // let its extension re-position it
}

function releaseAll() {
    for (const id of [...live.keys()]) release(id);
    updateBadge();
}

function removeTrayItem(id) {
    const s = settings();
    s.tray = s.tray.filter(x => x.id !== id); // first, so nothing re-adopts it while it is being released
    save();
    release(id);
    slots.get(id)?.remove();
    slots.delete(id);
    updateBadge();
}

/** Keep every tray button in its slot — also after its extension re-creates or re-appends it. */
function syncTray() {
    const s = settings();
    if (!s.enabled) { releaseAll(); return; }
    for (const item of s.tray) {
        const rec = live.get(item.id);
        const slot = slotFor(item);
        if (!slot.isConnected) panel.querySelector('.qd_tray').appendChild(slot); // never park a button off-DOM
        if (rec?.el.isConnected && slot.contains(rec.el)) continue;
        if (rec && !rec.el.isConnected) { rec.obs?.disconnect(); live.delete(item.id); }
        const el = live.get(item.id)?.el
            ?? queryAll(item.sel).find(x => !x.dataset.qdTray || x.dataset.qdTray === item.id);
        if (el && !el.contains(panel)) adopt(item, el);
    }
    updateBadge();
    updateTrayVisibility();
}

function trayElementGone(el) {
    return !el || el.hidden || getComputedStyle(el).display === 'none';
}

function updateTrayVisibility() {
    if (!panel) return;
    let any = false;
    for (const item of settings().tray) {
        const slot = slots.get(item.id);
        if (!slot) continue;
        const gone = trayElementGone(live.get(item.id)?.el);
        slot.classList.toggle('qd_gone', gone);
        any ||= !gone;
    }
    panel.querySelector('.qd_tray').classList.toggle('qd_empty', !any);
}

/** Dot on the launcher when a tray button reports trouble (data-state="attention", as Chat Auto Backup does). */
function updateBadge() {
    if (!launcher) return;
    let status = '';
    if (settings().statusDot) {
        for (const { el } of live.values()) {
            const st = String(el.dataset.state ?? '').toLowerCase();
            if (['attention', 'error', 'warning', 'alert'].includes(st)) { status = 'attention'; break; }
            if (['waiting', 'busy', 'saving'].includes(st)) status = 'waiting';
        }
    }
    launcher.dataset.status = status;
}

let syncTimer = null;
const domObserver = new MutationObserver(() => {
    if (syncTimer || !settings().tray.length) return;
    syncTimer = setTimeout(() => { syncTimer = null; syncTray(); }, 150);
});

// ---------------------------------------------------------------- pick mode (long-press a button)

let pick = null; // { kind, rebindId, path, timer, down, eatUntil, chosen, commitTimer }
let pickbar = null;
let hl = null;

const PICK_EVENTS = {
    pointerdown: onPickDown,
    pointermove: onPickMove,
    pointerup: onPickUp,
    pointercancel: onPickCancel,
    mouseup: onPickEat,
    touchend: onPickEat,
    click: onPickEat,
    contextmenu: onPickEat,
};

function ensurePickbar() {
    if (pickbar) return;
    pickbar = document.createElement('div');
    pickbar.id = 'qd_pickbar';
    pickbar.innerHTML = `
        <i class="fa-solid fa-hand-pointer"></i>
        <span class="qd_pick_msg"></span>
        <div class="menu_button qd_pick_move" title="ย้ายแถบนี้ไปบน/ล่าง ถ้าบังปุ่มที่ต้องการ"><i class="fa-solid fa-up-down"></i></div>
        <div class="menu_button qd_pick_cancel" title="ยกเลิก"><i class="fa-solid fa-xmark"></i></div>`;
    document.body.appendChild(pickbar);
    hl = document.createElement('div');
    hl.id = 'qd_hl';
    document.body.appendChild(hl);

    pickbar.querySelector('.qd_pick_cancel').addEventListener('click', () => endPick());
    pickbar.querySelector('.qd_pick_move').addEventListener('click', () => {
        const s = settings();
        s.pickbarBottom = !pickbar.classList.contains('qd_bottom');
        save();
        pickbar.classList.remove('qd_mid');
        pickbar.classList.toggle('qd_bottom', s.pickbarBottom);
    });
}

function startPick(kind, rebindId = null) {
    if (pick) endPick();
    closePanel();
    ensurePickbar();
    pick = { kind, rebindId, path: [], timer: null, down: null, eatUntil: 0, chosen: null, commitTimer: null };
    document.documentElement.classList.add('qd_picking');
    pickbar.classList.add('qd_show');
    pickbar.classList.toggle('qd_bottom', !!settings().pickbarBottom);
    for (const [type, fn] of Object.entries(PICK_EVENTS)) window.addEventListener(type, fn, { capture: true, passive: false });
    pickbar.querySelector('.qd_pick_msg').textContent = kind === 'sc'
        ? 'เปิดเมนูได้ตามปกติ แล้วกดค้างที่ปุ่มที่อยากทำเป็นช็อตคัท · แตะปุ่มหลักเพื่อยกเลิก'
        : 'กดค้างที่ปุ่มลอยที่อยากเก็บเข้า dock · แตะปุ่มหลักเพื่อยกเลิก';
    hl.classList.remove('qd_show');
    if (kind === 'tray') dodgeFloating();
}

/** Don't sit on top of the floating buttons the user is about to long-press. */
function dodgeFloating() {
    const floating = scanFloating().map(el => el.getBoundingClientRect());
    const covers = () => {
        const b = pickbar.getBoundingClientRect();
        return floating.some(r => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top);
    };
    const pref = settings().pickbarBottom ? 'qd_bottom' : '';
    for (const spot of [pref, pref ? '' : 'qd_bottom', 'qd_mid']) {
        pickbar.classList.remove('qd_bottom', 'qd_mid');
        if (spot) pickbar.classList.add(spot);
        if (!covers()) return;
    }
    pickbar.classList.remove('qd_bottom', 'qd_mid');
    if (pref) pickbar.classList.add(pref);
}

function endPick() {
    if (!pick) return;
    clearTimeout(pick.timer);
    clearTimeout(pick.commitTimer);
    for (const [type, fn] of Object.entries(PICK_EVENTS)) window.removeEventListener(type, fn, { capture: true });
    pick = null;
    document.documentElement.classList.remove('qd_picking');
    pickbar?.classList.remove('qd_show');
    hl?.classList.remove('qd_show');
}

const inPickbar = e => !!e.target?.closest?.('#qd_pickbar');
const eat = e => { if (e.cancelable) e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

function onPickDown(e) {
    if (!pick || inPickbar(e) || e.button > 0) return;
    if (pick.chosen) { commitPick(); return; }            // previous press finished without a pointerup
    if (pick.eatUntil === Infinity) pick.eatUntil = 0;
    clearTimeout(pick.timer);
    pick.down = { x: e.clientX, y: e.clientY, id: e.pointerId, target: e.target };
    pick.timer = setTimeout(fireLongPress, LONG_PRESS_MS);
}

function onPickMove(e) {
    if (!pick?.down || e.pointerId !== pick.down.id) return;
    if (Math.hypot(e.clientX - pick.down.x, e.clientY - pick.down.y) > MOVE_TOLERANCE) {
        clearTimeout(pick.timer);
        pick.down = null;
    }
}

/** Finger lifted after a successful long-press: swallow this release, then save. */
function releaseAfterLongPress() {
    pick.eatUntil = performance.now() + 450;
    clearTimeout(pick.commitTimer);
    pick.commitTimer = setTimeout(commitPick, 350);
}

function onPickUp(e) {
    if (!pick) return;
    if (pick.down && e.pointerId === pick.down.id) { clearTimeout(pick.timer); pick.down = null; }
    if (pick.eatUntil === Infinity && !inPickbar(e)) { eat(e); releaseAfterLongPress(); }
}

function onPickCancel(e) {
    if (!pick || !e.isTrusted) return;
    if (pick.down && e.pointerId === pick.down.id) { clearTimeout(pick.timer); pick.down = null; }
    if (pick.eatUntil === Infinity) releaseAfterLongPress();
}

function onPickEat(e) {
    if (!pick || inPickbar(e)) return;
    if (e.type === 'contextmenu') { e.preventDefault(); return; }
    if (performance.now() < pick.eatUntil || pick.eatUntil === Infinity) { eat(e); return; }
    if (e.type === 'click' && e.isTrusted && pick.kind === 'sc' && !isOwn(e.target)) {
        const el = clickableOf(e.target);
        if (!el) return;
        const sel = buildSelector(el);
        if (pick.path.at(-1) !== sel) pick.path.push(sel);
        if (pick.path.length > 8) pick.path.shift();
    }
}

function fireLongPress() {
    if (!pick?.down) return;
    const { target, id } = pick.down;
    pick.down = null;
    if (!target || isOwn(target)) return;
    pick.eatUntil = Infinity;
    // Tell the pressed button its press is over, so e.g. drag handlers don't fire on release.
    try { target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: id, isPrimary: true })); } catch { /* ignore */ }
    let el = pick.kind === 'tray' ? floatingRootOf(target) : clickableOf(target);
    if (el && pick.kind === 'sc') {
        const r = el.getBoundingClientRect(), { vw, vh } = viewportSize();
        if (r.width > vw * 0.6 && r.height > vh * 0.4) el = null; // a whole panel, not a button
    }
    if (!el) {
        toast.warn(pick.kind === 'tray' ? 'ตรงนี้ไม่ใช่ปุ่มลอย ลองกดค้างที่ปุ่มลอยของ extension' : 'เลือกปุ่มนี้ไม่ได้ ลองปุ่มอื่น');
        return;
    }
    if (pick.kind === 'tray' && el.dataset.qdTray) { toast.info('ปุ่มนี้อยู่ใน dock แล้ว'); return; }
    navigator.vibrate?.(15);
    pick.chosen = el;
    const r = el.getBoundingClientRect();
    Object.assign(hl.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    hl.classList.add('qd_show');
    pickbar.querySelector('.qd_pick_msg').textContent = 'ได้แล้ว — ยกนิ้วขึ้นเพื่อบันทึก';
    // Safety net if the browser never reports the finger lifting.
    clearTimeout(pick.commitTimer);
    pick.commitTimer = setTimeout(commitPick, 4000);
}

function pickPath(targetSel) {
    return pick.path.filter(p => p !== targetSel).slice(-MAX_PATH);
}

/** Save the picked button straight away, then open the editor so it can be renamed. */
function commitPick() {
    if (!pick?.chosen) return;
    const s = settings();
    const { kind, rebindId, chosen: el } = pick;
    let editId = null;
    if (kind === 'sc') {
        const sel = buildSelector(el);
        const existing = rebindId ? s.shortcuts.find(x => x.id === rebindId) : null;
        if (existing) {
            Object.assign(existing, { sel, path: pickPath(sel) });
            delete existing.builtin;
            editId = existing.id;
        } else {
            editId = newId('s');
            s.shortcuts.push({ id: editId, label: labelOf(el), icon: iconOf(el), sel, path: pickPath(sel) });
        }
    } else {
        const sel = buildSelector(el, { structural: false }) ?? buildSelector(el);
        const dup = s.tray.find(x => x.sel === sel);
        if (dup) {
            toast.info('ปุ่มนี้อยู่ใน dock แล้ว');
            editId = dup.id;
        } else {
            editId = newId('t');
            s.tray.push({ id: editId, label: labelOf(el), sel });
            if (!buildSelector(el, { structural: false })) toast.warn('ปุ่มนี้ไม่มี id ที่แน่นอน หลังรีโหลดอาจหาไม่เจอ');
        }
    }
    save();
    endPick();
    openPanel();
    setEditing(true);
    openEditor(kind, editId);
    renderSettingsLists();
}

// ---------------------------------------------------------------- settings panel

function colorRow(id, label, key, which) {
    return `<label for="${id}">${label}</label>
        <div class="qd_colorpick">
            <select id="${id}" class="text_pole">${Object.entries(COLOR_SOURCES).map(([k, [name]]) => `<option value="${k}">${esc(name)}</option>`).join('')}</select>
            <input type="color" id="${id}_pick" aria-label="${label} (กำหนดเอง)">
        </div>`;
}

function renderSettings() {
    const s = settings();
    const html = `
    <div id="qd_settings" class="qd_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Quick Dock</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label"><input type="checkbox" id="qd_enabled"> เปิดใช้ Quick Dock</label>
                <div class="qd_set_grid">
                    <label for="qd_layout">รูปแบบช็อตคัท</label>
                    <select id="qd_layout" class="text_pole">
                        <option value="arc">วงโค้งรอบปุ่ม (นิ้วโป้ง)</option>
                        <option value="grid">แผงตาราง</option>
                    </select>
                    <label for="qd_size">ขนาดปุ่มหลัก (px)</label>
                    <input type="number" id="qd_size" class="text_pole" min="28" max="90" step="1">
                    <label for="qd_cols">ช็อตคัทต่อแถว (แผงตาราง)</label>
                    <input type="number" id="qd_cols" class="text_pole" min="2" max="8" step="1">
                </div>
                <div class="qd_set_title">ไอคอนปุ่มหลัก</div>
                <div class="qd_set_iconrow">
                    <span id="qd_icon_prev" class="qd_set_iconprev"></span>
                    <input type="text" id="qd_icon" class="text_pole" placeholder="อีโมจิ หรือ fa-solid fa-bolt">
                </div>
                <div id="qd_icon_grid" class="qd_icongrid">${iconGridHTML()}</div>
                <label class="checkbox_label"><input type="checkbox" id="qd_close_sc"> ปิดแผงหลังกดช็อตคัท</label>
                <label class="checkbox_label"><input type="checkbox" id="qd_close_tray"> ปิดแผงหลังกดปุ่มลอยใน dock</label>
                <label class="checkbox_label" title="เช่น Chat Auto Backup ขึ้น Attention! ปุ่มหลักจะมีจุดแดงกระพริบ แม้ปิดแผงอยู่"><input type="checkbox" id="qd_dot"> จุดแจ้งสถานะบนปุ่มหลัก</label>
                <div class="qd_set_title">หน้าตา <div id="qd_preview" class="menu_button qd_inline_btn" title="เปิด dock ค้างไว้ระหว่างปรับ"><i class="fa-solid fa-eye"></i> ดูตัวอย่าง</div></div>
                <div class="qd_set_grid">
                    <label for="qd_labelmode">ชื่อใต้ปุ่มช็อตคัท</label>
                    <select id="qd_labelmode" class="text_pole">
                        <option value="show">แสดง</option>
                        <option value="hide">ไม่แสดง</option>
                        <option value="edit">แสดงเฉพาะตอนแก้ไข</option>
                    </select>
                    <label for="qd_itemsize">ขนาดปุ่มช็อตคัท (px)</label>
                    <input type="number" id="qd_itemsize" class="text_pole" min="30" max="80" step="1">
                    <label for="qd_iconscale">ขนาดไอคอน (% ของปุ่ม)</label>
                    <input type="number" id="qd_iconscale" class="text_pole" min="25" max="75" step="1">
                    ${colorRow('qd_c_icon', 'สีไอคอน', 'iconColor', 'icon')}
                    ${colorRow('qd_c_bg', 'สีพื้นปุ่ม', 'bgColor', 'bg')}
                    ${colorRow('qd_c_border', 'สีขอบ', 'borderColor', 'border')}
                    ${colorRow('qd_c_accent', 'สีเน้น (ตอนกด/เลือก)', 'accentColor', 'accent')}
                    <label for="qd_bgop">ความทึบพื้นปุ่ม <output id="qd_bgop_out"></output></label>
                    <input type="range" id="qd_bgop" min="0" max="100" step="5">
                    <label for="qd_idleop">ความทึบปุ่มหลักตอนปิด <output id="qd_idleop_out"></output></label>
                    <input type="range" id="qd_idleop" min="15" max="100" step="5">
                    <label for="qd_fx">เอฟเฟกต์ตอนชี้/กด</label>
                    <select id="qd_fx" class="text_pole">${Object.entries(FX).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
                </div>
                <label class="checkbox_label"><input type="checkbox" id="qd_shadow"> เงาใต้ปุ่ม</label>
                <label class="checkbox_label" title="สวยขึ้นแต่กิน GPU โดยเฉพาะบนมือถือ"><input type="checkbox" id="qd_blur"> เบลอพื้นหลังใต้ปุ่ม (กิน GPU)</label>
                <div class="qd_set_btns"><div id="qd_look_reset" class="menu_button"><i class="fa-solid fa-rotate-left"></i> คืนค่าหน้าตาเริ่มต้น</div></div>
                <div class="qd_set_btns">
                    <div id="qd_add_sc" class="menu_button"><i class="fa-solid fa-plus"></i> เพิ่มช็อตคัท</div>
                    <div id="qd_add_tray" class="menu_button"><i class="fa-solid fa-inbox"></i> เก็บปุ่มลอย</div>
                    <div id="qd_scan" class="menu_button" title="หาปุ่มลอยบนหน้าจอให้อัตโนมัติ"><i class="fa-solid fa-magnifying-glass"></i> ค้นหาปุ่มลอย</div>
                    <div id="qd_reset_pos" class="menu_button" title="ย้ายปุ่มหลักไปมุมขวาล่าง"><i class="fa-solid fa-crosshairs"></i> รีเซ็ตตำแหน่ง</div>
                </div>
                <div id="qd_scan_result" class="qd_set_list"></div>
                <div class="qd_set_title">ช็อตคัท</div>
                <div id="qd_list_sc" class="qd_set_list"></div>
                <div class="qd_set_title">ปุ่มลอยใน dock</div>
                <div id="qd_list_tray" class="qd_set_list"></div>
                <small class="qd_note">ถือมือถือมือขวา: ลากปุ่มหลักไปขอบขวาล่าง ช็อตคัทจะกางเป็นวงโค้งในระยะนิ้วโป้ง · ช็อตคัทแรก ๆ อยู่ใกล้นิ้วที่สุด · กดค้างปุ่มหลักเพื่อเปลี่ยนไอคอน</small>
            </div>
        </div>
    </div>`;
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!host) return;
    host.insertAdjacentHTML('beforeend', html);

    const $ = id => document.getElementById(id);
    const bindCheck = (id, key, after) => {
        $(id).checked = !!s[key];
        $(id).addEventListener('change', e => { s[key] = e.target.checked; save(); after?.(); });
    };
    const bindNum = (id, key, lo, hi) => {
        $(id).value = s[key];
        $(id).addEventListener('change', e => {
            const v = Math.round(Number(e.target.value));
            s[key] = Number.isFinite(v) ? clamp(v, lo, hi) : DEFAULTS[key];
            e.target.value = s[key];
            save();
            applyLook();
            if (isOpen()) renderPanel();
        });
    };
    bindCheck('qd_enabled', 'enabled', () => { applyLook(); if (s.enabled) syncTray(); else { closePanel(); releaseAll(); } });
    const restyle = () => { applyLook(); if (isOpen()) renderPanel(); };
    bindCheck('qd_shadow', 'shadow', restyle);
    bindCheck('qd_blur', 'blur', restyle);
    const bindSelect = (id, key) => {
        $(id).value = s[key];
        $(id).addEventListener('change', e => { s[key] = e.target.value; save(); restyle(); });
    };
    bindSelect('qd_labelmode', 'labelMode');
    bindSelect('qd_fx', 'fx');
    bindNum('qd_itemsize', 'itemSize', 30, 80);
    bindNum('qd_iconscale', 'iconScale', 25, 75);
    const bindRange = (id, key) => {
        const out = $(`${id}_out`);
        const show = () => { $(id).value = s[key]; out.textContent = `${s[key]}%`; };
        show();
        $(id).addEventListener('input', e => { s[key] = Number(e.target.value); out.textContent = `${s[key]}%`; save(); applyLook(); });
        return show;
    };
    const showBg = bindRange('qd_bgop', 'bgOpacity');
    const showIdle = bindRange('qd_idleop', 'idleOpacity');
    const colorInputs = [['qd_c_icon', 'iconColor', 'icon'], ['qd_c_bg', 'bgColor', 'bg'], ['qd_c_border', 'borderColor', 'border'], ['qd_c_accent', 'accentColor', 'accent']];
    const showColors = () => colorInputs.forEach(([id, key, which]) => {
        $(id).value = s[key];
        $(`${id}_pick`).value = s.customColors[which];
        $(`${id}_pick`).hidden = s[key] !== 'custom';
    });
    for (const [id, key, which] of colorInputs) {
        $(id).addEventListener('change', e => { s[key] = e.target.value; save(); showColors(); applyLook(); });
        $(`${id}_pick`).addEventListener('input', e => { s.customColors[which] = e.target.value; save(); applyLook(); });
    }
    showColors();
    $('qd_preview').addEventListener('click', () => openPanel());
    $('qd_look_reset').addEventListener('click', () => {
        for (const k of ['labelMode', 'itemSize', 'iconScale', 'iconColor', 'bgColor', 'borderColor', 'accentColor', 'bgOpacity', 'idleOpacity', 'blur', 'shadow', 'fx']) s[k] = DEFAULTS[k];
        s.customColors = { ...DEFAULTS.customColors };
        save();
        for (const [id, key] of [['qd_labelmode', 'labelMode'], ['qd_fx', 'fx'], ['qd_itemsize', 'itemSize'], ['qd_iconscale', 'iconScale']]) $(id).value = s[key];
        $('qd_shadow').checked = s.shadow;
        $('qd_blur').checked = s.blur;
        showBg(); showIdle(); showColors();
        restyle();
    });
    bindCheck('qd_close_sc', 'closeOnShortcut');
    bindCheck('qd_close_tray', 'closeOnTray');
    bindCheck('qd_dot', 'statusDot', updateBadge);
    bindNum('qd_size', 'size', 28, 90);
    bindNum('qd_cols', 'columns', 2, 8);
    $('qd_layout').value = s.layout;
    $('qd_layout').addEventListener('change', e => { s.layout = e.target.value === 'grid' ? 'grid' : 'arc'; save(); if (isOpen()) renderPanel(); });

    const setLauncherIcon = v => {
        s.icon = cleanIcon(v) || DEFAULTS.icon;
        save();
        applyLook();
        syncSettingsIcon();
    };
    $('qd_icon').addEventListener('change', e => setLauncherIcon(e.target.value));
    $('qd_icon_grid').addEventListener('click', e => {
        const ic = e.target.closest('[data-icon]')?.dataset.icon;
        if (ic) setLauncherIcon(ic);
    });
    syncSettingsIcon();

    $('qd_add_sc').addEventListener('click', () => startPick('sc'));
    $('qd_add_tray').addEventListener('click', () => startPick('tray'));
    $('qd_reset_pos').addEventListener('click', () => { s.pos = { ...DEFAULTS.pos }; save(); placeLauncher(); });
    $('qd_scan').addEventListener('click', renderScan);
    renderSettingsLists();
}

function syncSettingsIcon() {
    const s = settings();
    const prev = document.getElementById('qd_icon_prev');
    const inp = document.getElementById('qd_icon');
    if (prev) prev.innerHTML = iconHTML(s.icon);
    if (inp) inp.value = s.icon;
}

function renderScan() {
    const box = document.getElementById('qd_scan_result');
    if (!box) return;
    const found = scanFloating();
    if (!found.length) {
        box.innerHTML = '<div class="qd_set_row"><i>ไม่พบปุ่มลอยบนหน้าจอตอนนี้ (บางปุ่มจะขึ้นเมื่อเปิดแชทแล้ว) — ใช้ “เก็บปุ่มลอย” แล้วกดค้างที่ปุ่มแทนได้</i></div>';
        return;
    }
    box.innerHTML = found.map((el, i) => {
        const sel = buildSelector(el, { structural: false });
        return `<div class="qd_set_row" data-i="${i}">
            <span class="qd_set_name"><b>${esc(labelOf(el))}</b> <code>${esc(sel ?? buildSelector(el))}</code></span>
            <div class="menu_button qd_scan_show" title="กระพริบปุ่มนี้บนจอ"><i class="fa-solid fa-eye"></i></div>
            <div class="menu_button qd_scan_add" title="เก็บเข้า dock"><i class="fa-solid fa-inbox"></i></div>
        </div>`;
    }).join('');
    box.querySelectorAll('.qd_set_row').forEach(row => {
        const el = found[Number(row.dataset.i)];
        row.querySelector('.qd_scan_show').addEventListener('click', () => {
            el.classList.add('qd_flash');
            setTimeout(() => el.classList.remove('qd_flash'), 1600);
        });
        row.querySelector('.qd_scan_add').addEventListener('click', () => {
            const s = settings();
            const sel = buildSelector(el, { structural: false }) ?? buildSelector(el);
            if (!s.tray.some(x => x.sel === sel)) s.tray.push({ id: newId('t'), label: labelOf(el), sel });
            save();
            syncTray();
            row.remove();
            renderSettingsLists();
            toast.ok(`เก็บ “${esc(labelOf(el))}” เข้า dock แล้ว`);
        });
    });
}

function renderSettingsLists() {
    const s = settings();
    const scBox = document.getElementById('qd_list_sc');
    const trBox = document.getElementById('qd_list_tray');
    if (!scBox || !trBox) return;
    scBox.innerHTML = s.shortcuts.length
        ? s.shortcuts.map(sc => `<div class="qd_set_row" data-id="${esc(sc.id)}">
            <span class="qd_set_ic">${iconHTML(sc.icon)}</span>
            <span class="qd_set_name"><b>${esc(sc.label)}</b> ${sc.builtin ? `<small>(${esc(BUILTINS[sc.builtin]?.hint ?? '')})</small>` : `<code>${esc(sc.sel)}</code>`}${sc.path?.length ? ` <small>(+เปิดเมนู ${sc.path.length} ขั้น)</small>` : ''}</span>
            <div class="menu_button qd_row_del" title="ลบ"><i class="fa-solid fa-trash"></i></div></div>`).join('')
        : '<div class="qd_set_row"><i>ยังไม่มี</i></div>';
    trBox.innerHTML = s.tray.length
        ? s.tray.map(t => `<div class="qd_set_row" data-id="${esc(t.id)}">
            <span class="qd_set_ic"><i class="fa-solid ${live.has(t.id) ? 'fa-circle-check' : 'fa-circle-question'}" title="${live.has(t.id) ? 'อยู่ใน dock' : 'ยังไม่พบปุ่มนี้บนหน้า'}"></i></span>
            <span class="qd_set_name"><b>${esc(t.label)}</b> <code>${esc(t.sel)}</code></span>
            <div class="menu_button qd_row_del" title="คืนปุ่มนี้กลับไปลอยบนจอ"><i class="fa-solid fa-arrow-up-from-bracket"></i></div></div>`).join('')
        : '<div class="qd_set_row"><i>ยังไม่มี</i></div>';
    scBox.querySelectorAll('.qd_row_del').forEach(b => b.addEventListener('click', () => {
        removeShortcut(b.closest('.qd_set_row').dataset.id);
        renderSettingsLists();
        if (isOpen()) renderPanel();
    }));
    trBox.querySelectorAll('.qd_row_del').forEach(b => b.addEventListener('click', () => {
        removeTrayItem(b.closest('.qd_set_row').dataset.id);
        renderSettingsLists();
        if (isOpen()) renderPanel();
    }));
}

// ---------------------------------------------------------------- init

function init() {
    if (document.getElementById('qd_launcher')) return; // loaded twice
    settings();
    buildUI();
    applyLook();
    renderSettings();
    renderPanel();
    syncTray();
    domObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS Safari apply :active (press effects)
    const { eventSource, event_types: E } = ctx();
    if (E?.APP_READY) eventSource.on(E.APP_READY, () => { syncTray(); renderSettingsLists(); });
    if (E?.CHAT_CHANGED) eventSource.on(E.CHAT_CHANGED, () => syncTray());
    console.log(LOG, 'loaded');
}

globalThis.QuickDock = { settings, openPanel, closePanel, startPick, endPick, syncTray, releaseAll, scanFloating, buildSelector, runShortcut, computeArcSlots };

if (typeof jQuery === 'function') jQuery(init); else init();
