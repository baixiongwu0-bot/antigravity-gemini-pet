"""Batch process raw_gallery/ and full_cutout.png into pure-transparent, text-free, bottom-anchored assets/poses/ + manifest.json."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "raw_gallery"
OUT_ROOT = ROOT / "assets" / "poses"
CHIBI_DIR = OUT_ROOT / "chibi"
ILLUST_DIR = OUT_ROOT / "illust"
PREVIEW_PATH = ROOT / ".runtime" / "polish_check.jpg"

MAX_LONG_EDGE = 640
STAGE_MAX_W = 246.0
STAGE_MAX_H = 266.0

# 15 pure-transparent Chibi + 2 pure-transparent Illust (no rectangular background cards).
# All pure character cutouts allow natural horizontal mirroring (noMirror=False).
ENTRIES: list[dict] = [
    # ---------------- CHIBI (15 poses) ----------------
    {
        "id": "chibi_01_please",
        "source": "01d98d68ba86cd2d10af30584244294d.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "乖巧合手",
        "states": ["idle", "work_waiting", "click_shy", "click_wave"],
    },
    {
        "id": "chibi_02_shock",
        "source": "14e3f88a8974e4498c504e1b6e97ed47.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "惊吓捂脸",
        "states": ["work_error", "drag"],
    },
    {
        "id": "chibi_03_fighting",
        "source": "1efbb3a12f6a1d5f18f2e266264239c1.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "元气加油",
        "states": ["work_working", "walk", "star_magic", "toss_star"],
    },
    {
        "id": "chibi_04_tired",
        "source": "3707f494a257942ffb4d78c2232f55c1.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "脑容量告急",
        "states": ["work_thinking", "work_error", "stretch"],
    },
    {
        "id": "chibi_05_hooray",
        "source": "3b30414fd5cf97f9c7709547c475fd67.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "欢呼庆祝",
        "states": ["work_success", "click_happy", "click_tickle", "hum", "spin_show", "toss_star"],
    },
    {
        "id": "chibi_06_pout",
        "source": "436f9e2a0966fdbefed963dd39f6f73b.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "抱臂傲娇",
        "states": ["click_tsundere"],
    },
    {
        "id": "chibi_07_melon",
        "source": "6714e85f4c9f6e33e2f40ef53d5a37b4.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "暗中吃瓜观察",
        "states": ["peek", "work_waiting", "eat_fish", "eat_cookie"],
    },
    {
        "id": "chibi_08_roger",
        "source": "84623ba6e1460fe1df56a36cf31580b6.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "元气收到",
        "states": ["work_working", "work_result", "click_wave"],
    },
    {
        "id": "chibi_09_thanks",
        "source": "966914f43410a088fe02fce846e191b9.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "温柔比心",
        "states": ["idle", "work_success", "work_result", "click_happy", "groom", "turn"],
    },
    {
        "id": "chibi_10_happy",
        "source": "b9ae2dc03796760945cc8a30df8e16ee.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "捧脸开心",
        "states": ["click_happy", "click_tickle", "hum"],
    },
    {
        "id": "chibi_11_love",
        "source": "c154ef611c6a1dd9797c5654a83af6d2.png",
        "style": "chibi",
        "mode": "white_flood_love_heart",
        "label": "抱心相伴",
        "states": ["idle", "click_shy", "groom", "eat_cookie"],
    },
    {
        "id": "chibi_12_awesome",
        "source": "cccf9cf3a4ae0676b269709cb2803bdf.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "点赞庆祝",
        "states": ["work_success", "work_result", "click_happy", "toss_star"],
    },
    {
        "id": "chibi_13_cry",
        "source": "efe51d404fa9e07fae60b4843b87c0ac.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "擦泪委屈",
        "states": ["work_error", "drag", "click_shy"],
    },
    {
        "id": "chibi_14_coffee",
        "source": "f39ff8cb1145af49ef0c35067979f6f8.png",
        "style": "chibi",
        "mode": "rgba_trim",
        "label": "捧咖啡杯待机",
        "states": [
            "idle",
            "work_working",
            "work_thinking",
            "click_wave",
            "eat_cookie",
            "eat_fish",
            "walk",
            "turn",
            "spin_show",
            "star_magic",
        ],
    },
    {
        "id": "chibi_15_sleep",
        "source": "f63095d6452ec759ebdd78a2ed83f5f8.png",
        "style": "chibi",
        "mode": "white_flood",
        "label": "抱星打盹",
        "states": ["sleep_start", "sleep_loop", "sleep_end", "stretch"],
    },
    # ---------------- ILLUST (2 pure-transparent full-body poses) ----------------
    {
        "id": "illust_01_full",
        "source": "__FULL_CUTOUT__",
        "style": "illust",
        "mode": "rgba_trim_nowatermark",
        "label": "星芒猫娘全身立绘",
        "states": [
            "idle",
            "walk",
            "turn",
            "stretch",
            "peek",
            "hum",
            "groom",
            "toss_star",
            "star_magic",
            "spin_show",
            "eat_fish",
            "eat_cookie",
            "click_happy",
            "click_tickle",
            "click_wave",
            "work_thinking",
            "work_working",
            "work_result",
            "work_waiting",
            "work_success",
            "sleep_start",
            "sleep_loop",
            "sleep_end",
        ],
    },
    {
        "id": "illust_02_shy_stand",
        "source": "6abe519f57ff618b013913404776fcb1.png",
        "style": "illust",
        "mode": "white_flood",
        "label": "微羞乖巧立绘",
        "states": [
            "idle",
            "turn",
            "peek",
            "groom",
            "click_shy",
            "click_tsundere",
            "click_tickle",
            "drag",
            "work_thinking",
            "work_waiting",
            "work_error",
            "sleep_start",
            "sleep_loop",
            "sleep_end",
        ],
    },
]


def crop_bottom_watermark(im: Image.Image, ratio: float = 0.926) -> Image.Image:
    """Remove bottom ~7.4% strip containing the centered Douyin watermark."""
    w, h = im.size
    crop_h = max(16, int(round(h * ratio)))
    return im.crop((0, 0, w, crop_h))


def estimate_background_field(rgb: np.ndarray) -> np.ndarray:
    """Build a smooth 2D pastel-white background field from the perimeter borders."""
    h, w, _ = rgb.shape
    min_c = rgb.min(axis=2)
    max_c = rgb.max(axis=2)
    is_pale = (min_c >= 205.0) & ((max_c - min_c) <= 45.0)

    border_mask = np.zeros((h, w), dtype=bool)
    pad = max(6, min(h, w) // 80)
    border_mask[:pad, :] = True
    border_mask[-pad:, :] = True
    border_mask[:, :pad] = True
    border_mask[:, -pad:] = True

    seeds = border_mask & is_pale
    if seeds.sum() < 20:
        fallback = np.array([245.0, 245.0, 250.0], dtype=np.float32)
        return np.broadcast_to(fallback, (h, w, 3)).copy()

    step = max(1, min(h, w) // 160)
    small_rgb = rgb[::step, ::step]
    small_seeds = seeds[::step, ::step]
    if not small_seeds.any():
        small_seeds[0, 0] = True
        small_seeds[0, -1] = True
    _, idx = ndimage.distance_transform_edt(~small_seeds, return_indices=True)
    field_small = small_rgb[idx[0], idx[1]]
    for ch in range(3):
        field_small[:, :, ch] = ndimage.gaussian_filter(field_small[:, :, ch], sigma=12.0, mode="nearest")

    field_im = Image.fromarray(np.clip(field_small, 0, 255).astype(np.uint8), mode="RGB").resize(
        (w, h), Image.Resampling.BILINEAR
    )
    return np.asarray(field_im, dtype=np.float32)


def cutout_white_sticker(im: Image.Image, strip_top_pink_bridge: bool = False) -> Image.Image:
    """
    Flood-fill background removal from perimeter against smooth 2D background field,
    optional #21 top pink-text bridge separation, edge feathering + color unmixing,
    and strict single-largest-component isolation (removes 100% of floating text/symbols).
    """
    rgb = np.asarray(im.convert("RGB"), dtype=np.float32)
    h, w, _ = rgb.shape
    bg_field = estimate_background_field(rgb)

    diff_bg = np.linalg.norm(rgb - bg_field, axis=2)
    min_c = rgb.min(axis=2)
    max_c = rgb.max(axis=2)
    chroma = max_c - min_c
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]

    gx = np.abs(ndimage.sobel(lum, axis=1, mode="nearest"))
    gy = np.abs(ndimage.sobel(lum, axis=0, mode="nearest"))
    grad = np.hypot(gx, gy) / 4.0

    is_near_field = (diff_bg <= 34.0) & (min_c >= 198.0) & (chroma <= 48.0)
    is_white_halo = (min_c >= 216.0) & (chroma <= 36.0)
    candidate_bg = (is_near_field | is_white_halo) & (grad <= 28.0)

    # For #21 (c154ef61): separate warm pink curved text ('有你在，真好！') in upper band
    # while keeping cool-purple cat ears, ahoge, hair, and inner ear fills intact.
    if strip_top_pink_bridge:
        cool_hair = (rgb[:, :, 2] > rgb[:, :, 0] + 8.0) & (min_c < 230.0)
        cool_filled = ndimage.binary_fill_holes(ndimage.binary_closing(cool_hair, iterations=4))
        top_band = np.zeros((h, w), dtype=bool)
        top_band[: int(round(h * 0.235)), :] = True
        is_warm_pink = (rgb[:, :, 0] > rgb[:, :, 2] + 8.0) & (rgb[:, :, 0] > 110.0)
        candidate_bg = candidate_bg | (top_band & is_warm_pink & (~cool_filled))

    labeled, _ = ndimage.label(candidate_bg)
    border_labels = set()
    border_labels.update(np.unique(labeled[0, :]).tolist())
    border_labels.update(np.unique(labeled[-1, :]).tolist())
    border_labels.update(np.unique(labeled[:, 0]).tolist())
    border_labels.update(np.unique(labeled[:, -1]).tolist())
    border_labels.discard(0)

    ext_bg = np.isin(labeled, list(border_labels))

    dilated = ndimage.binary_dilation(ext_bg, iterations=2)
    soft_ext = (
        dilated
        & ((diff_bg <= 38.0) | ((min_c >= 214.0) & (chroma <= 38.0)))
        & (min_c >= 200.0)
        & (chroma <= 46.0)
        & (grad <= 24.0)
    )
    ext_bg = ext_bg | soft_ext

    # Keep ONLY the single largest connected foreground component (character + held props).
    # This cleanly eliminates all detached Chinese banner text, speech bubbles, clouds, and sparkles.
    fg_raw = ~ext_bg
    fg_labeled, fg_count = ndimage.label(fg_raw, structure=np.ones((3, 3), dtype=int))
    if fg_count > 1:
        sizes = np.bincount(fg_labeled.ravel())
        sizes[0] = 0
        fg_mask = fg_labeled == int(np.argmax(sizes))
    else:
        fg_mask = fg_raw

    ext_bg = ~fg_mask

    if ext_bg.any():
        _, bg_nn_idx = ndimage.distance_transform_edt(~ext_bg, return_indices=True)
        local_bg = rgb[bg_nn_idx[0], bg_nn_idx[1]]
    else:
        local_bg = bg_field

    diff_local = np.linalg.norm(rgb - local_bg, axis=2)
    dist_in = ndimage.distance_transform_edt(fg_mask)

    alpha = np.where(fg_mask, 1.0, 0.0).astype(np.float32)
    rim = (dist_in > 0.0) & (dist_in <= 2.8)

    rim_coverage = np.clip((diff_local - 12.0) / 54.0, 0.0, 1.0)
    geom_ramp = np.clip((dist_in - 0.50) / 1.65, 0.0, 1.0)
    is_bright_rim = (diff_local < 68.0) & (min_c > 165.0) & (chroma < 60.0)
    alpha_rim = np.where(is_bright_rim, np.minimum(rim_coverage, geom_ramp), np.clip(dist_in / 1.15, 0.0, 1.0))
    alpha = np.where(rim, alpha_rim, alpha)
    alpha[ext_bg] = 0.0

    solid_fg = dist_in > 2.8
    out_rgb = rgb.copy()
    if solid_fg.any():
        _, nn_idx = ndimage.distance_transform_edt(~solid_fg, return_indices=True)
        nearest_solid = rgb[nn_idx[0], nn_idx[1]]

        semi = (alpha > 0.01) & (alpha < 0.98)
        safe_a = np.maximum(alpha[:, :, None], 0.16)
        unmixed = np.clip((rgb - (1.0 - alpha[:, :, None]) * local_bg) / safe_a, 0.0, 255.0)

        unmixed_diff = np.linalg.norm(unmixed - local_bg, axis=2)
        solid_diff = np.linalg.norm(nearest_solid - local_bg, axis=2)
        blend_w = np.clip((1.0 - alpha) * 1.45, 0.0, 1.0)
        needs_ink_pull = semi & ((unmixed_diff < solid_diff * 0.85) | (unmixed.min(axis=2) > 222.0))
        final_edge = np.where(
            needs_ink_pull[:, :, None],
            unmixed * (1.0 - blend_w[:, :, None]) + nearest_solid * blend_w[:, :, None],
            unmixed,
        )
        out_rgb = np.where(semi[:, :, None], final_edge, out_rgb)
        # Bleed nearest solid color into transparent background pixels so Lanczos resize never bleeds white
        out_rgb = np.where((alpha <= 0.01)[:, :, None], nearest_solid, out_rgb)

    rgba = np.dstack([np.clip(out_rgb, 0, 255), np.clip(alpha * 255.0, 0, 255)]).astype(np.uint8)
    return Image.fromarray(rgba, mode="RGBA")


def keep_largest_alpha_component(im: Image.Image) -> Image.Image:
    """Zero out secondary disconnected islands on an already-transparent RGBA image."""
    rgba = np.asarray(im.convert("RGBA")).copy()
    mask = rgba[:, :, 3] > 15
    lbl, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=int))
    if count > 1:
        sizes = np.bincount(lbl.ravel())
        sizes[0] = 0
        main_mask = lbl == int(np.argmax(sizes))
        # Zero any secondary island pixel >15 and anything outside 1px anti-aliased border of main_mask
        keep_soft = ndimage.binary_dilation(main_mask, iterations=1)
        rgba[~keep_soft, 3] = 0
        rgba[(~main_mask) & (rgba[:, :, 3] > 15), 3] = 0
    return Image.fromarray(rgba, mode="RGBA")


def defringe_resized_rgba(im: Image.Image) -> Image.Image:
    """Clean any residual bright white fringe introduced by downscaling semi-transparent borders."""
    rgba = np.asarray(im.convert("RGBA"), dtype=np.float32).copy()
    a = rgba[:, :, 3]
    solid = a >= 225.0
    if not solid.any():
        return im
    _, nn_idx = ndimage.distance_transform_edt(~solid, return_indices=True)
    nearest_solid = rgba[nn_idx[0], nn_idx[1], :3]
    semi_white = (a > 8.0) & (a < 210.0) & (rgba[:, :, 0] > 232.0) & (rgba[:, :, 1] > 232.0) & (rgba[:, :, 2] > 232.0)
    if semi_white.any():
        w = np.clip((210.0 - a) / 195.0, 0.0, 1.0)[:, :, None]
        rgba[:, :, :3] = np.where(semi_white[:, :, None], rgba[:, :, :3] * (1.0 - w) + nearest_solid * w, rgba[:, :, :3])
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), mode="RGBA")


def tight_crop_and_resize(im: Image.Image, max_edge: int = MAX_LONG_EDGE) -> Image.Image:
    """Tightly crop to alpha > 15 (0px padding, flush bottom edge), resize, and re-trim bottom."""
    rgba = im.convert("RGBA")

    def _crop_alpha15(img: Image.Image) -> Image.Image:
        alpha = np.asarray(img)[:, :, 3]
        ys, xs = np.where(alpha > 15)
        if len(xs) == 0 or len(ys) == 0:
            return img
        return img.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))

    rgba = _crop_alpha15(rgba)
    w, h = rgba.size
    long_edge = max(w, h)
    if long_edge > max_edge:
        scale = max_edge / long_edge
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        rgba = rgba.resize((nw, nh), Image.Resampling.LANCZOS)
        # Re-isolate single largest component, defringe Lanczos edge, and re-trim after downscaling
        rgba = keep_largest_alpha_component(rgba)
        rgba = defringe_resized_rgba(rgba)
        rgba = _crop_alpha15(rgba)
    return rgba


def measure_visual_mass(im: Image.Image) -> tuple[float, float]:
    """
    Estimate rendered head mass (row opaque pixels around y in [0.18..0.42]) and sqrt(opaque area).
    """
    arr = np.asarray(im.convert("RGBA"))
    h, w, _ = arr.shape
    mask = arr[:, :, 3] > 24
    fit = min(STAGE_MAX_W / w, STAGE_MAX_H / h)
    row_sums = mask.sum(axis=1)
    y0 = int(h * 0.18)
    y1 = max(y0 + 2, int(h * 0.42))
    head_mass = float(np.median(row_sums[y0:y1])) * fit
    sqrt_area = math.sqrt(max(1.0, float(mask.sum()))) * fit
    return head_mass, sqrt_area


def compute_normalized_scales(items: list[dict]) -> None:
    """Compute visualScale per pose so head/body proportions stay consistent across transitions."""
    metrics: dict[str, tuple[float, float]] = {}
    for item in items:
        im = Image.open(OUT_ROOT / item["file"]).convert("RGBA")
        hm, sa = measure_visual_mass(im)
        metrics[item["id"]] = (hm, sa)
        item["_raw_head_w"] = round(hm, 1)

    chibi_ref = metrics.get("chibi_14_coffee", (134.4, 191.3))
    illust_ref = metrics.get("illust_01_full", (127.6, 144.2))

    for item in items:
        if item["style"] == "illust":
            # Full-body illusts: keep natural fit height aligned cleanly (no vertical overflow)
            item["visualScale"] = 1.0 if item["id"] == "illust_01_full" else 1.015
            continue
        hm, sa = metrics[item["id"]]
        r_head = chibi_ref[0] / max(20.0, hm)
        r_area = chibi_ref[1] / max(20.0, sa)
        combined = 0.45 * r_head + 0.55 * r_area
        clamped = max(0.90, min(1.08, combined))
        item["visualScale"] = round(clamped, 3)


def build_polish_check_sheet(items: list[dict]) -> None:
    """Render all 17 tight-cropped poses onto a single inspection grid at PREVIEW_PATH."""
    cols = 6
    rows = math.ceil(len(items) / cols)
    cell_w, cell_h = 260, 296
    img_h = 246

    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (24, 27, 36))
    draw = ImageDraw.Draw(sheet)

    for idx, item in enumerate(items):
        r_idx, c_idx = divmod(idx, cols)
        x0, y0 = c_idx * cell_w, r_idx * cell_h

        draw.rectangle([x0 + 4, y0 + 4, x0 + cell_w // 2, y0 + img_h], fill=(22, 24, 34))
        draw.rectangle([x0 + cell_w // 2, y0 + 4, x0 + cell_w - 4, y0 + img_h], fill=(64, 68, 88))
        draw.rectangle([x0 + 4, y0 + 4, x0 + cell_w - 4, y0 + cell_h - 4], outline=(110, 120, 152))

        im = Image.open(OUT_ROOT / item["file"]).convert("RGBA")
        # Draw baseline guide at bottom of stage box so flush ground contact is visible
        base_y = y0 + img_h - 6
        draw.line([(x0 + 14, base_y), (x0 + cell_w - 14, base_y)], fill=(120, 220, 255), width=1)

        im.thumbnail((cell_w - 20, img_h - 16), Image.Resampling.LANCZOS)
        tw, th = im.size
        tx = x0 + (cell_w - tw) // 2
        ty = base_y - th
        sheet.paste(im, (tx, ty), im)

        tag = f"[{item['style']}] {item['id']}"
        meta = f"{item['width']}x{item['height']} vs={item['visualScale']:.2f} hw={item['_raw_head_w']}"
        draw.text((x0 + 10, y0 + img_h + 4), tag, fill=(255, 238, 160))
        draw.text((x0 + 10, y0 + img_h + 22), meta, fill=(195, 224, 255))

    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(PREVIEW_PATH, quality=90)
    print(f"Saved polish check sheet -> {PREVIEW_PATH} ({sheet.size[0]}x{sheet.size[1]})")


def main() -> None:
    CHIBI_DIR.mkdir(parents=True, exist_ok=True)
    ILLUST_DIR.mkdir(parents=True, exist_ok=True)

    for d in (CHIBI_DIR, ILLUST_DIR):
        for old in d.glob("*.png"):
            old.unlink()

    manifest_poses: list[dict] = []
    for entry in ENTRIES:
        src_name = entry["source"]
        if src_name == "__FULL_CUTOUT__":
            src_path = ROOT / "assets" / "layers" / "full_cutout.png"
        else:
            src_path = RAW_DIR / src_name

        if not src_path.exists():
            raise FileNotFoundError(f"Missing source asset: {src_path}")

        im = Image.open(src_path)
        mode = entry["mode"]

        if mode == "white_flood":
            cropped = crop_bottom_watermark(im, 0.926)
            processed = cutout_white_sticker(cropped, strip_top_pink_bridge=False)
        elif mode == "white_flood_love_heart":
            cropped = crop_bottom_watermark(im, 0.926)
            processed = cutout_white_sticker(cropped, strip_top_pink_bridge=True)
        elif mode == "rgba_trim":
            cropped = crop_bottom_watermark(im, 0.926)
            processed = keep_largest_alpha_component(cropped)
        elif mode == "rgba_trim_nowatermark":
            processed = keep_largest_alpha_component(im)
        else:
            raise ValueError(f"Unknown mode: {mode}")

        final_im = tight_crop_and_resize(processed, MAX_LONG_EDGE)
        rel_file = f"{entry['style']}/{entry['id']}.png"
        out_path = OUT_ROOT / rel_file
        final_im.save(out_path, optimize=True)

        w, h = final_im.size
        manifest_poses.append(
            {
                "id": entry["id"],
                "file": rel_file,
                "style": entry["style"],
                "label": entry["label"],
                "noMirror": False,
                "width": w,
                "height": h,
                "visualScale": 1.0,
                "states": list(entry["states"]),
            }
        )

    compute_normalized_scales(manifest_poses)
    build_polish_check_sheet(manifest_poses)

    # Strip internal diagnostic keys before writing manifest.json
    clean_poses = [{k: v for k, v in p.items() if not k.startswith("_")} for p in manifest_poses]
    manifest = {
        "version": 2,
        "generatedBy": "scripts/process-gallery.py",
        "counts": {
            "chibi": sum(1 for p in clean_poses if p["style"] == "chibi"),
            "illust": sum(1 for p in clean_poses if p["style"] == "illust"),
            "total": len(clean_poses),
        },
        "poses": clean_poses,
    }
    manifest_path = OUT_ROOT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote manifest -> {manifest_path} ({manifest['counts']})")


if __name__ == "__main__":
    main()
