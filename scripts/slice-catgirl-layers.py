#!/usr/bin/env python3
"""
High-precision 2x sharpening, zero-fringe background removal, color decontamination,
and 2.5D skeletal layer + local expression slicing for reference.png.

Strictly writes only to D-drive project paths; uses no network downloads.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

os.environ.setdefault("TEMP", r"D:\Temp")
os.environ.setdefault("TMP", r"D:\Temp")

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage


ROOT = Path(r"D:\AI\antigravity-gemini-pet")
REF_PATH = ROOT / "assets" / "reference.png"
LAYERS_DIR = ROOT / "assets" / "layers"
ICON_PATH = ROOT / "assets" / "icon.png"
CHECK_PATH = ROOT / ".runtime" / "layers-check.png"


def make_alpha_and_decontaminate(rgb_2x: np.ndarray) -> np.ndarray:
    """
    Compute clean anti-aliased RGBA (828x1482) from white-background RGB artwork:
    1. Border flood-fill on near-white background + keep 3 primary components (body + 2 stars).
    2. Remove genuine interior white holes (between hair curls & thighs) while strictly
       protecting white clothing (socks, ruffles, sleeves, ear fluff, face/skin highlights).
    3. Soft sub-pixel edge feather + local foreground color decontamination to eliminate
       any white halo on dark desktop or IDE themes.
    """
    h, w, _ = rgb_2x.shape
    arr = rgb_2x.astype(np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    dist_w = np.sqrt(np.sum((255.0 - arr) ** 2, axis=2))
    chroma = arr.max(axis=2) - arr.min(axis=2)

    # Step 1: Exterior flood fill (captures soft anti-aliased outer white margin)
    near_white = dist_w < 28.0
    lbl, _ = ndimage.label(near_white)
    border_labels = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    border_labels.discard(0)
    ext_bg = np.isin(lbl, list(border_labels))

    # Keep only 3 major foreground components (character, star_left, star_right)
    fg_raw = ~ext_bg
    fg_lbl, fg_n = ndimage.label(fg_raw)
    keep = np.zeros((h, w), dtype=bool)
    for idx in range(1, fg_n + 1):
        if np.count_nonzero(fg_lbl == idx) >= 400:
            keep |= fg_lbl == idx

    # Step 2: Remove interior genuine pure-white pockets (hair loops & between thighs)
    yy, xx = np.mgrid[0:h, 0:w]
    protected = (
        ((xx >= 455) & (xx <= 510) & (yy >= 95) & (yy <= 160))  # right ear fluff
        | ((xx >= 265) & (xx <= 335) & (yy >= 120) & (yy <= 200))  # left ear fluff
        | ((xx >= 320) & (xx <= 515) & (yy >= 175) & (yy <= 340))  # face & skin
        | ((xx >= 190) & (xx <= 325) & (yy >= 380) & (yy <= 580))  # left white sleeve
        | ((xx >= 510) & (xx <= 660) & (yy >= 430) & (yy <= 600))  # right white sleeve
        | ((xx >= 355) & (xx <= 460) & (yy >= 370) & (yy <= 510))  # chest white top
        | ((xx >= 270) & (xx <= 600) & (yy >= 615) & (yy <= 815))  # white skirt ruffles
        | ((xx >= 315) & (xx <= 585) & (yy >= 1090) & (yy <= 1350))  # white socks & boot trim
        | ((xx >= 450) & (xx <= 545) & (yy >= 950) & (yy <= 1130))  # leg highlight
        | ((xx >= 660) & (xx <= 795) & (yy >= 415) & (yy <= 500))  # outstretched hand
    )

    cand_hole = keep & (dist_w < 21.0) & (chroma < 12.0) & (~protected)
    hlbl, hn = ndimage.label(cand_hole)
    holes = np.zeros((h, w), dtype=bool)
    for idx in range(1, hn + 1):
        mask = hlbl == idx
        cnt = np.count_nonzero(mask)
        if cnt >= 35 and dist_w[mask].mean() < 10.5:
            holes |= mask

    fg = keep & (~holes)

    # Step 3: Smooth alpha matte at 1-2px transition band
    # Distance from background inside foreground and vice versa
    dist_to_bg = ndimage.distance_transform_edt(fg)
    # Anti-aliased partial coverage band where pixels are bright & within 2px of bg
    alpha = fg.astype(np.float32)

    edge_band = fg & (dist_to_bg <= 2.4)
    # Soften alpha strictly on bright edge pixels blended with white background
    # Using dist_w: pure lineart edges are dark (dist_w > 120 -> alpha=1), white fringe has small dist_w
    t_white = np.clip((dist_w - 22.0) / 56.0, 0.0, 1.0)
    # Preserve genuinely light clothing/skin interiors slightly inside (>1.5px from bg) unless very close to edge
    edge_alpha = np.where(dist_to_bg <= 1.2, np.minimum(1.0, t_white * 1.15), np.clip(0.55 + 0.45 * t_white, 0.0, 1.0))
    # Never fade dark lineart!
    dark_ink = dist_w > 95.0
    edge_alpha = np.where(dark_ink, 1.0, edge_alpha)
    alpha = np.where(edge_band, edge_alpha, alpha)

    # Slight 0.45px anti-alias smoothing only on the outer silhouette
    alpha_smooth = ndimage.gaussian_filter(alpha, sigma=0.45)
    alpha = np.where(dist_to_bg <= 2.5, alpha_smooth, alpha)
    alpha = np.clip(alpha, 0.0, 1.0)
    # Crisp zero outside
    alpha[~fg & (ndimage.distance_transform_edt(~fg) > 1.2)] = 0.0

    # Step 4: Color decontamination (un-premultiply white background bleed on edge pixels)
    # Find nearest pure interior foreground color (dist_to_bg > 2.2)
    interior = fg & (dist_to_bg > 2.2)
    _, nearest_idx = ndimage.distance_transform_edt(~interior, return_indices=True)
    nearest_rgb = arr[nearest_idx[0], nearest_idx[1]]

    # On semi-transparent boundary pixels, recover true color by removing white background contribution
    # C_observed = a * C_fg + (1 - a) * 255  =>  C_fg = (C_observed - (1 - a) * 255) / a
    decontam_band = (alpha > 0.02) & (alpha < 0.96)
    safe_a = np.maximum(alpha, 0.14)[..., None]
    unmixed = (arr - (1.0 - alpha[..., None]) * 255.0) / safe_a
    unmixed = np.clip(unmixed, 0.0, 255.0)
    # Blend unmixed with nearest interior color where alpha is very small to suppress JPEG white speckle
    w_near = np.clip((0.55 - alpha) / 0.45, 0.0, 1.0)[..., None]
    clean_edge_rgb = (1.0 - w_near) * unmixed + w_near * nearest_rgb

    out_rgb = np.where(decontam_band[..., None], clean_edge_rgb, arr)
    # Also darken any leftover near-white pixels strictly on the 1px outer rim if nearest interior is darker
    rim1 = fg & (dist_to_bg <= 1.2) & (dist_w < 75.0)
    out_rgb = np.where(rim1[..., None], 0.35 * out_rgb + 0.65 * nearest_rgb, out_rgb)

    rgba = np.dstack([
        np.clip(out_rgb, 0, 255).astype(np.uint8),
        np.clip(alpha * 255.0, 0, 255).astype(np.uint8),
    ])
    return rgba


def poly_mask(h: int, w: int, pts: list[tuple[float, float]]) -> np.ndarray:
    img = Image.new("L", (w, h), 0)
    ImageDraw.Draw(img).polygon(pts, fill=255)
    return np.array(img) > 127


def feather_mask(mask: np.ndarray, radius: float = 1.5) -> np.ndarray:
    return ndimage.gaussian_filter(mask.astype(np.float32), sigma=radius)


def inpaint_behind(rgba: np.ndarray, hole_mask: np.ndarray, valid_region: np.ndarray, blur_sigma: float = 4.0) -> np.ndarray:
    """
    Fill pixels inside `hole_mask` from nearest valid pixels inside `valid_region` so
    occluded layer tabs never show seams when rotated.
    """
    out = rgba.copy()
    seed = valid_region & (~hole_mask) & (rgba[:, :, 3] > 180)
    if not np.any(seed):
        return out
    _, idx = ndimage.distance_transform_edt(~seed, return_indices=True)
    filled_rgb = rgba[idx[0], idx[1], :3].astype(np.float32)
    # Smooth filled RGB gently to avoid blocky Voronoi seams
    for c in range(3):
        ch = filled_rgb[:, :, c]
        filled_rgb[:, :, c] = ndimage.gaussian_filter(ch, sigma=blur_sigma)

    # Fade alpha cleanly from border of seed outward up to ~18px inside hole
    dist_out = ndimage.distance_transform_edt(~seed)
    fill_alpha = np.clip(1.0 - np.maximum(0.0, dist_out - 14.0) / 8.0, 0.0, 1.0) * 255.0
    apply = hole_mask & (dist_out <= 22.0)
    for c in range(3):
        out[:, :, c] = np.where(apply, np.clip(filled_rgb[:, :, c], 0, 255).astype(np.uint8), out[:, :, c])
    out[:, :, 3] = np.where(apply, np.maximum(out[:, :, 3], fill_alpha.astype(np.uint8)), out[:, :, 3])
    return out


def crop_and_save(rgba: np.ndarray, name: str) -> dict:
    ys, xs = np.where(rgba[:, :, 3] > 3)
    if len(ys) == 0:
        raise RuntimeError(f"Empty layer: {name}")
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    pad = 2
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(rgba.shape[1], x1 + pad)
    y1 = min(rgba.shape[0], y1 + pad)
    Image.fromarray(rgba, mode="RGBA").save(LAYERS_DIR / f"{name}.png", format="PNG", optimize=True)
    return {"file": f"{name}.png", "bbox": [x0, y0, x1, y1]}


def build_expression_overlays(head_rgba: np.ndarray) -> dict[str, dict]:
    """
    Generate illustration-matched local facial expression overlays aligned to the
    exact -13.2 deg head tilt and skin/lash palette of head_rgba (828x1482).
    """
    h, w, _ = head_rgba.shape
    rgb = head_rgba[:, :, :3].astype(np.float32)
    alpha = head_rgba[:, :, 3].astype(np.float32) / 255.0

    # Hair mask over face so bangs stay naturally IN FRONT of closed/smiling eyelids!
    # Strictly purple/blue hair (B > R + 10 and B > G + 10) — never matches pink/magenta iris!
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    bang_hair = (alpha > 0.35) & (b > r + 10.0) & (b > g + 10.0)

    # Eye centers & tilt angle measured in 2x space:
    # Left pink eye center: (382, 263), Right gold eye center: (462, 244)
    # Tilt angle ~ -13.2 deg
    ang = np.arctan2(244.0 - 263.0, 462.0 - 382.0)  # ~ -0.233 rad
    ca, sa = np.cos(ang), np.sin(ang)

    # Sample clean local skin color right under left & right eyes
    skin_l_patch = rgb[278:292, 368:398]
    skin_r_patch = rgb[260:274, 448:478]
    skin_l = np.median(skin_l_patch.reshape(-1, 3), axis=0)
    skin_r = np.median(skin_r_patch.reshape(-1, 3), axis=0)
    skin_m = np.median(rgb[276:292, 412:436].reshape(-1, 3), axis=0)
    lash_col = (58, 34, 68, 255)
    brow_col = (72, 48, 92, 255)
    mouth_col = (132, 76, 86, 255)

    def make_skin_eye_patch(canvas_img: Image.Image, cx: float, cy: float, rx: float, ry: float, base_skin: np.ndarray) -> None:
        """Paint soft skin-toned eyelid cover strictly underneath bangs."""
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(overlay)
        # Draw tilted ellipse sampled on fine grid
        yy, xx = np.mgrid[max(0, int(cy - 36)):min(h, int(cy + 36)), max(0, int(cx - 38)):min(w, int(cx + 38))]
        dx = xx - cx
        dy = yy - cy
        ux = dx * ca + dy * sa
        uy = -dx * sa + dy * ca
        ell = np.sqrt((ux / rx) ** 2 + (uy / ry) ** 2)
        patch_a = np.clip((1.05 - ell) / 0.25, 0.0, 1.0)
        # Subtle warm upper eyelid shadow gradient
        shade = np.clip((-uy / ry) * 0.5 + 0.5, 0.0, 1.0)
        pr = np.clip(base_skin[0] - shade * 8.0, 0, 255)
        pg = np.clip(base_skin[1] - shade * 12.0, 0, 255)
        pb = np.clip(base_skin[2] - shade * 6.0, 0, 255)

        sub_bang = bang_hair[yy, xx]
        sub_head = alpha[yy, xx]
        final_a = patch_a * np.where(sub_bang, 0.0, 1.0) * sub_head

        arr_o = np.array(overlay)
        arr_o[yy, xx, 0] = pr.astype(np.uint8)
        arr_o[yy, xx, 1] = pg.astype(np.uint8)
        arr_o[yy, xx, 2] = pb.astype(np.uint8)
        arr_o[yy, xx, 3] = (final_a * 255.0).astype(np.uint8)
        canvas_img.alpha_composite(Image.fromarray(arr_o, "RGBA"))

    def make_mouth_patch(canvas_img: Image.Image) -> None:
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        cx, cy = 420.0, 294.0
        yy, xx = np.mgrid[274:316, 392:448]
        dx = xx - cx
        dy = yy - cy
        ux = dx * ca + dy * sa
        uy = -dx * sa + dy * ca
        ell = np.sqrt((ux / 19.0) ** 2 + (uy / 11.0) ** 2)
        pa = np.clip((1.05 - ell) / 0.28, 0.0, 1.0) * alpha[yy, xx]
        arr_o = np.array(overlay)
        arr_o[yy, xx, 0] = int(skin_m[0])
        arr_o[yy, xx, 1] = int(skin_m[1])
        arr_o[yy, xx, 2] = int(skin_m[2])
        arr_o[yy, xx, 3] = (pa * 255.0).astype(np.uint8)
        canvas_img.alpha_composite(Image.fromarray(arr_o, "RGBA"))

    def rot_pt(cx: float, cy: float, lx: float, ly: float) -> tuple[float, float]:
        return (cx + lx * ca - ly * sa, cy + lx * sa + ly * ca)

    def draw_lash_arc(draw: ImageDraw.ImageDraw, cx: float, cy: float, pts_local: list[tuple[float, float]], width: int, col: tuple[int, int, int, int]) -> None:
        pts = [rot_pt(cx, cy, lx, ly) for lx, ly in pts_local]
        draw.line(pts, fill=col, width=width, joint="curve")

    def mask_under_bangs(img: Image.Image) -> Image.Image:
        arr_i = np.array(img)
        arr_i[:, :, 3] = np.where(bang_hair, 0, arr_i[:, :, 3])
        return Image.fromarray(arr_i, "RGBA")

    overlays_meta: dict[str, dict] = {}

    # 1. expr_blink_half.png
    im_half = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    make_skin_eye_patch(im_half, 382, 255, 28, 17, skin_l)
    make_skin_eye_patch(im_half, 463, 236, 28, 17, skin_r)
    dh = ImageDraw.Draw(im_half)
    for cx, cy in [(382, 261), (463, 242)]:
        draw_lash_arc(dh, cx, cy, [(-22, -2), (-10, 2), (2, 3), (15, 0), (22, -4)], 5, lash_col)
    im_half = mask_under_bangs(im_half)
    overlays_meta["expr_blink_half"] = crop_and_save(np.array(im_half), "expr_blink_half")

    # 2. expr_blink_closed.png
    im_closed = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    make_skin_eye_patch(im_closed, 382, 263, 29, 25, skin_l)
    make_skin_eye_patch(im_closed, 463, 244, 29, 25, skin_r)
    dc = ImageDraw.Draw(im_closed)
    for cx, cy in [(382, 268), (463, 249)]:
        draw_lash_arc(dc, cx, cy, [(-21, -2), (-8, 4), (4, 5), (17, 1), (23, -4)], 5, lash_col)
        draw_lash_arc(dc, cx, cy, [(-16, 4), (-21, 7)], 3, lash_col)
    im_closed = mask_under_bangs(im_closed)
    overlays_meta["expr_blink_closed"] = crop_and_save(np.array(im_closed), "expr_blink_closed")

    # 3. expr_smile.png (happy curved crescent eyes + cute open cat smile)
    im_smile = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    make_skin_eye_patch(im_smile, 382, 263, 29, 25, skin_l)
    make_skin_eye_patch(im_smile, 463, 244, 29, 25, skin_r)
    make_mouth_patch(im_smile)
    ds = ImageDraw.Draw(im_smile)
    for cx, cy in [(382, 264), (463, 245)]:
        draw_lash_arc(ds, cx, cy, [(-20, 4), (-10, -7), (2, -9), (14, -5), (21, 5)], 5, lash_col)
        draw_lash_arc(ds, cx, cy, [(-17, 2), (-23, -1)], 3, lash_col)
    # Cute cat smile :3
    draw_lash_arc(ds, 420, 294, [(-11, -2), (-6, 3), (0, 0), (6, 3), (11, -2)], 3, mouth_col)
    # Warm pink cheek blush
    blush = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    yy, xx = np.mgrid[0:h, 0:w]
    for bx, by in [(365, 289), (471, 264)]:
        d2 = ((xx - bx) / 20.0) ** 2 + ((yy - by) / 10.0) ** 2
        ba = np.clip(1.0 - d2, 0.0, 1.0) ** 1.6 * 0.42 * alpha
        barr = np.array(blush)
        barr[:, :, 0] = 255
        barr[:, :, 1] = 128
        barr[:, :, 2] = 168
        barr[:, :, 3] = np.maximum(barr[:, :, 3], (ba * 255).astype(np.uint8))
        blush = Image.fromarray(barr, "RGBA")
    im_smile.alpha_composite(blush)
    im_smile = mask_under_bangs(im_smile)
    overlays_meta["expr_smile"] = crop_and_save(np.array(im_smile), "expr_smile")

    # 4. expr_sleep.png (peaceful sleeping eyelashes + soft relaxed mouth)
    im_sleep = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    make_skin_eye_patch(im_sleep, 382, 263, 29, 25, skin_l)
    make_skin_eye_patch(im_sleep, 463, 244, 29, 25, skin_r)
    make_mouth_patch(im_sleep)
    dsl = ImageDraw.Draw(im_sleep)
    for cx, cy in [(382, 269), (463, 250)]:
        draw_lash_arc(dsl, cx, cy, [(-20, 0), (-8, 5), (4, 5), (16, 1), (22, -2)], 4, lash_col)
    # Soft sleepy oval mouth
    mx, my = rot_pt(420, 295, 0, 0)
    dsl.ellipse([mx - 5, my - 4, mx + 5, my + 4], fill=(244, 152, 168, 220), outline=mouth_col, width=2)
    im_sleep = mask_under_bangs(im_sleep)
    overlays_meta["expr_sleep"] = crop_and_save(np.array(im_sleep), "expr_sleep")

    # 5. expr_shy.png (intense rosy cheek blush + cute blush hash lines + bashful mouth)
    im_shy = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    make_mouth_patch(im_shy)
    yy, xx = np.mgrid[0:h, 0:w]
    barr = np.zeros((h, w, 4), dtype=np.uint8)
    for bx, by in [(366, 288), (470, 264)]:
        d2 = ((xx - bx) / 26.0) ** 2 + ((yy - by) / 13.0) ** 2
        ba = np.clip(1.0 - d2, 0.0, 1.0) ** 1.4 * 0.68 * alpha
        barr[:, :, 0] = 255
        barr[:, :, 1] = 114
        barr[:, :, 2] = 158
        barr[:, :, 3] = np.maximum(barr[:, :, 3], (ba * 255).astype(np.uint8))
    im_shy.alpha_composite(Image.fromarray(barr, "RGBA"))
    dshy = ImageDraw.Draw(im_shy)
    for bx, by in [(366, 288), (470, 264)]:
        for off in (-10, 0, 10):
            p1 = rot_pt(bx + off, by, -2, 5)
            p2 = rot_pt(bx + off, by, 3, -5)
            dshy.line([p1, p2], fill=(238, 92, 138, 175), width=2)
    draw_lash_arc(dshy, 420, 294, [(-7, 1), (-2, -2), (3, 1), (8, -2)], 3, mouth_col)
    im_shy = mask_under_bangs(im_shy)
    overlays_meta["expr_shy"] = crop_and_save(np.array(im_shy), "expr_shy")

    # 6. expr_sweat.png (anime sweat drop on right temple + pouty wavy mouth + furrowed brow)
    im_sweat = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    make_mouth_patch(im_sweat)
    dsw = ImageDraw.Draw(im_sweat)
    # Pouty wavy mouth
    draw_lash_arc(dsw, 420, 295, [(-10, 2), (-4, -2), (2, 2), (9, -1)], 3, mouth_col)
    # Slight furrowed brows
    draw_lash_arc(dsw, 380, 238, [(-14, -4), (10, 3)], 3, brow_col)
    draw_lash_arc(dsw, 458, 220, [(-10, 3), (14, -4)], 3, brow_col)
    im_sweat = mask_under_bangs(im_sweat)
    # Draw anime sweat drop ON TOP of temple/bangs at (495, 224) so it stays crisp and visible
    dsw_top = ImageDraw.Draw(im_sweat)
    sx, sy = 495, 224
    dsw_top.polygon([(sx, sy - 18), (sx - 10, sy + 5), (sx, sy + 14), (sx + 10, sy + 5)], fill=(176, 228, 255, 248), outline=(72, 112, 186, 255))
    dsw_top.ellipse([sx - 9, sy - 2, sx + 9, sy + 15], fill=(176, 228, 255, 248), outline=(72, 112, 186, 255), width=2)
    dsw_top.ellipse([sx - 4, sy + 2, sx + 1, sy + 8], fill=(255, 255, 255, 245))
    overlays_meta["expr_sweat"] = crop_and_save(np.array(im_sweat), "expr_sweat")

    # 7. expr_sparkle.png (4-point Gemini sparkle highlights inside both heterochromia irises)
    im_sp = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dsp = ImageDraw.Draw(im_sp)
    for cx, cy, col in [(384, 266, (255, 240, 255, 245)), (462, 246, (255, 252, 225, 245))]:
        r_big = 9
        pts = [
            (cx, cy - r_big),
            (cx + 2.5, cy - 2.5),
            (cx + r_big, cy),
            (cx + 2.5, cy + 2.5),
            (cx, cy + r_big),
            (cx - 2.5, cy + 2.5),
            (cx - r_big, cy),
            (cx - 2.5, cy - 2.5),
        ]
        dsp.polygon(pts, fill=col)
        dsp.ellipse([cx - 12, cy - 10, cx - 7, cy - 5], fill=(255, 255, 255, 245))
    im_sp = mask_under_bangs(im_sp)
    overlays_meta["expr_sparkle"] = crop_and_save(np.array(im_sp), "expr_sparkle")

    return overlays_meta


def generate_hd_icon(full_rgba: np.ndarray, out_path: Path) -> None:
    """Create a crisp 128x128 cosmic badge icon from the real cut-out catgirl portrait."""
    size = 128
    # Crop head + cat ears + neck/upper shoulders so the portrait flows naturally to bottom edge
    head_crop = Image.fromarray(full_rgba, "RGBA").crop((230, 48, 590, 408)).resize((120, 120), Image.Resampling.LANCZOS)

    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    yy, xx = np.mgrid[0:size, 0:size]
    # Rounded square cosmic backdrop
    dx = np.maximum(np.abs(xx - 63.5) - 36.0, 0.0)
    dy = np.maximum(np.abs(yy - 63.5) - 36.0, 0.0)
    dist = np.sqrt(dx * dx + dy * dy) - 24.0
    bg_a = np.clip(0.5 - dist, 0.0, 1.0)
    t = (xx * 0.4 + yy * 0.6) / 128.0
    bg_arr = np.zeros((size, size, 4), dtype=np.uint8)
    bg_arr[:, :, 0] = np.clip(28 + t * 52, 0, 255).astype(np.uint8)
    bg_arr[:, :, 1] = np.clip(24 + t * 28, 0, 255).astype(np.uint8)
    bg_arr[:, :, 2] = np.clip(64 + t * 88, 0, 255).astype(np.uint8)
    bg_arr[:, :, 3] = (bg_a * 255.0).astype(np.uint8)
    bg = Image.fromarray(bg_arr, "RGBA")

    fg_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fg_layer.paste(head_crop, (4, 8), head_crop)
    # Mask fg strictly inside rounded badge (and fade softly near very bottom edge)
    fg_arr = np.array(fg_layer)
    fg_arr[:, :, 3] = (fg_arr[:, :, 3].astype(np.float32) * bg_a).astype(np.uint8)
    bg.alpha_composite(Image.fromarray(fg_arr, "RGBA"))

    # Subtle glowing ring on top
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle([4, 4, 123, 123], radius=26, outline=(168, 150, 255, 195), width=2)
    bg.save(out_path, format="PNG", optimize=True)


def main() -> None:
    LAYERS_DIR.mkdir(parents=True, exist_ok=True)
    CHECK_PATH.parent.mkdir(parents=True, exist_ok=True)

    im = Image.open(REF_PATH).convert("RGB")
    w2, h2 = im.width * 2, im.height * 2  # 828 x 1482
    im2 = im.resize((w2, h2), Image.Resampling.LANCZOS)
    im2 = im2.filter(ImageFilter.UnsharpMask(radius=1.1, percent=55, threshold=4))
    rgb_2x = np.array(im2)

    rgba = make_alpha_and_decontaminate(rgb_2x)
    full_alpha = rgba[:, :, 3] > 2

    # Connected components for isolated floating Gemini 4-point stars
    lbl, n = ndimage.label(full_alpha)
    star_left_mask = np.zeros((h2, w2), dtype=bool)
    star_right_mask = np.zeros((h2, w2), dtype=bool)
    main_mask = np.zeros((h2, w2), dtype=bool)
    for i in range(1, n + 1):
        m = lbl == i
        ys, xs = np.where(m)
        cx, cy = xs.mean(), ys.mean()
        if len(ys) < 250:
            continue
        if cx < 250 and cy < 420:
            star_left_mask |= m
        elif cx > 580 and cy < 340:
            star_right_mask |= m
        else:
            main_mask |= m

    # Define surgical polygons in 828x1482 space
    # 1. Left & Right Cat Ears (drawn behind head crown/hairclip, with tucked base overlap)
    ear_left_poly = poly_mask(h2, w2, [(240, 100), (358, 120), (366, 165), (305, 205), (255, 195)])
    ear_right_poly = poly_mask(h2, w2, [(410, 118), (506, 40), (532, 130), (505, 178), (432, 148)])

    # Ear masks strictly exclude the star hairclip on the right ear & front bangs
    ear_left_mask = main_mask & ear_left_poly
    ear_right_mask = main_mask & ear_right_poly
    # Strip outer ear tips from head; keep tucked root overlap inside ear masks
    ear_left_cut = main_mask & poly_mask(h2, w2, [(240, 100), (350, 118), (344, 152), (306, 185), (260, 192)])
    ear_right_cut = main_mask & poly_mask(h2, w2, [(420, 115), (506, 40), (528, 122), (486, 134), (445, 130)])

    # 2. Head mask (ahoge + crown + side buns + star hairclip + face + bangs down to jawline, minus outer ear tips)
    head_poly = poly_mask(h2, w2, [
        (248, 42),
        (575, 42),
        (575, 225),
        (518, 255),
        (492, 286),
        (456, 316),
        (424, 336),
        (388, 326),
        (376, 312),  # skirts cleanly around finger tip at (384, 316)
        (320, 304),
        (264, 285),
        (245, 200),
    ])
    head_mask = (main_mask & head_poly) & (~ear_left_cut) & (~ear_right_cut)

    # 3. Left & Right dangling ribbons
    ribbon_left_poly = poly_mask(h2, w2, [
        (132, 756), (172, 772), (144, 830), (118, 910), (140, 1140), (50, 1130), (56, 860), (96, 782),
    ])
    # Exclude bright pale cloak corner at top-left of ribbon attachment (120..168, 752..798)
    cloak_left_corner = poly_mask(h2, w2, [(115, 745), (175, 755), (165, 802), (118, 788)])
    ribbon_left_mask = main_mask & ribbon_left_poly & (~cloak_left_corner)

    ribbon_right_poly = poly_mask(h2, w2, [
        (652, 708), (748, 795), (788, 910), (766, 1160), (668, 1155), (676, 975), (702, 895), (674, 815), (632, 742),
    ])
    ribbon_right_mask = main_mask & ribbon_right_poly

    # 4. Cat Tail (left sweeping tail + blue fur behind right thigh)
    tail_left_poly = poly_mask(h2, w2, [
        (140, 915), (344, 920), (346, 1005), (342, 1225), (142, 1225),
    ])
    tail_right_poly = poly_mask(h2, w2, [
        (444, 812), (528, 812), (522, 968), (434, 995), (416, 982), (435, 920),
    ])
    # Also tiny peek of tail between thighs at (362..392, 938..976)
    tail_gap_poly = poly_mask(h2, w2, [(360, 936), (394, 936), (392, 978), (362, 976)])
    tail_mask = main_mask & (tail_left_poly | tail_right_poly | tail_gap_poly)

    # 5. Back Hair (lush wavy blue-purple-pink curls flanking both sides behind arms & cloak)
    back_hair_left = poly_mask(h2, w2, [
        (0, 260), (348, 250), (350, 345), (274, 342), (242, 370), (200, 405),
        (196, 570), (234, 670), (148, 745), (85, 790), (0, 795),
    ])
    back_hair_right = poly_mask(h2, w2, [
        (518, 210), (828, 210), (828, 790), (678, 780), (650, 710), (638, 560),
        (586, 430), (524, 340), (492, 290),
    ])
    # Protect outstretched right hand inside back_hair_right (skin & outline at x=654..794, y=420..498)
    r_px, g_px, b_px = rgba[:, :, 0].astype(np.float32), rgba[:, :, 1].astype(np.float32), rgba[:, :, 2].astype(np.float32)
    hand_box = poly_mask(h2, w2, [(656, 430), (710, 434), (735, 412), (765, 422), (795, 458), (788, 488), (738, 498), (682, 482), (656, 466)])
    is_skin_or_hand = hand_box & ((r_px > g_px + 8) | ((r_px < 120) & (g_px < 100) & (b_px < 105)))

    back_hair_mask = (main_mask & (back_hair_left | back_hair_right) & (~head_mask) & (~ear_left_cut) & (~ear_right_cut) & (~is_skin_or_hand))

    # 6. Body (torso + sleeves + arms + skirt + legs + boots)
    body_mask = (
        main_mask
        & (~head_mask)
        & (~ear_left_cut)
        & (~ear_right_cut)
        & (~back_hair_mask)
        & (~tail_mask)
        & (~ribbon_left_mask)
        & (~ribbon_right_mask)
    )

    def extract_layer(mask: np.ndarray, feather_px: float = 0.0) -> np.ndarray:
        layer = np.zeros_like(rgba)
        if feather_px > 0:
            w_m = np.clip(feather_mask(mask, feather_px), 0.0, 1.0)
            layer[:, :, :3] = rgba[:, :, :3]
            layer[:, :, 3] = (rgba[:, :, 3].astype(np.float32) * w_m).astype(np.uint8)
        else:
            layer[mask] = rgba[mask]
        return layer

    star_left_rgba = extract_layer(star_left_mask)
    star_right_rgba = extract_layer(star_right_mask)
    ear_left_rgba = extract_layer(ear_left_mask)
    ear_right_rgba = extract_layer(ear_right_mask)
    head_rgba = extract_layer(head_mask)
    ribbon_left_rgba = extract_layer(ribbon_left_mask)
    ribbon_right_rgba = extract_layer(ribbon_right_mask)
    tail_rgba = extract_layer(tail_mask)
    back_hair_rgba = extract_layer(back_hair_mask)
    body_rgba = extract_layer(body_mask)

    # Seamless occlusion extensions (behind upper layers so animations never expose gaps!)
    # A) Extend tail behind legs STRICTLY along the hidden leg-crossing corridor (not spilling below knee!)
    tail_bridge_zone = poly_mask(h2, w2, [(330, 932), (455, 868), (470, 948), (402, 988), (328, 988)])
    tail_rgba = inpaint_behind(tail_rgba, tail_bridge_zone & (~tail_mask), tail_mask, blur_sigma=4.5)

    # B) Extend back_hair gently under right hand & upper sleeve edges (only inside hair envelope)
    hair_fill_hole = (hand_box | poly_mask(h2, w2, [(190, 390), (260, 390), (260, 560), (190, 560)])) & (~back_hair_mask)
    back_hair_rgba = inpaint_behind(back_hair_rgba, hair_fill_hole, back_hair_mask, blur_sigma=4.5)
    back_hair_rgba[~main_mask] = 0

    # C) Extend neck top on body upward 14px behind chin so head tilt never reveals a collar gap
    neck_tab = poly_mask(h2, w2, [(398, 312), (464, 304), (468, 342), (398, 342)]) & (~body_mask)
    body_rgba = inpaint_behind(body_rgba, neck_tab, body_mask & poly_mask(h2, w2, [(390, 326), (470, 320), (470, 365), (390, 365)]), blur_sigma=2.5)

    # D) Extend ribbon top anchors 14px upward behind cloak hem
    rl_tab = poly_mask(h2, w2, [(124, 738), (176, 750), (174, 780), (120, 770)]) & (~ribbon_left_mask)
    ribbon_left_rgba = inpaint_behind(ribbon_left_rgba, rl_tab, ribbon_left_mask, blur_sigma=2.5)
    rr_tab = poly_mask(h2, w2, [(625, 692), (668, 695), (674, 745), (625, 745)]) & (~ribbon_right_mask)
    ribbon_right_rgba = inpaint_behind(ribbon_right_rgba, rr_tab, ribbon_right_mask, blur_sigma=2.5)

    # Save full cutout + all 10 part PNGs
    layers_meta: dict[str, dict] = {}
    layers_meta["full_cutout"] = crop_and_save(rgba, "full_cutout")
    layers_meta["star_left"] = crop_and_save(star_left_rgba, "star_left")
    layers_meta["star_right"] = crop_and_save(star_right_rgba, "star_right")
    layers_meta["back_hair"] = crop_and_save(back_hair_rgba, "back_hair")
    layers_meta["tail"] = crop_and_save(tail_rgba, "tail")
    layers_meta["ribbon_left"] = crop_and_save(ribbon_left_rgba, "ribbon_left")
    layers_meta["ribbon_right"] = crop_and_save(ribbon_right_rgba, "ribbon_right")
    layers_meta["body"] = crop_and_save(body_rgba, "body")
    layers_meta["ear_left"] = crop_and_save(ear_left_rgba, "ear_left")
    layers_meta["ear_right"] = crop_and_save(ear_right_rgba, "ear_right")
    layers_meta["head"] = crop_and_save(head_rgba, "head")

    # Build local expression overlays matching original artwork
    expr_meta = build_expression_overlays(head_rgba)

    # Update extension icon from real catgirl portrait
    generate_hd_icon(rgba, ICON_PATH)

    # Write rig.json (all pivots in 828x1482 reference coordinates)
    rig = {
        "width": w2,
        "height": h2,
        "source": "assets/reference.png (2x Lanczos sharpened)",
        "anchors": {
            "root": [430, 1418],
            "body": [430, 1418],
            "head": [428, 330],
            "ear_left": [326, 174],
            "ear_right": [468, 134],
            "back_hair": [420, 260],
            "tail": [432, 836],
            "ribbon_left": [152, 772],
            "ribbon_right": [652, 728],
            "star_left": [176, 340],
            "star_right": [658, 244],
        },
        "layers": layers_meta,
        "expressions": expr_meta,
    }
    (LAYERS_DIR / "rig.json").write_text(json.dumps(rig, indent=2, ensure_ascii=False), encoding="utf-8")

    # Build visual verification sheet on dark checkerboard (.runtime/layers-check.png)
    cw, ch = w2 * 2 + 420, h2
    tile = 24
    yy, xx = np.mgrid[0:ch, 0:cw]
    checker = (((xx // tile) + (yy // tile)) % 2) == 0
    bg = np.zeros((ch, cw, 4), dtype=np.uint8)
    bg[checker] = [26, 22, 48, 255]
    bg[~checker] = [38, 32, 68, 255]
    board = Image.fromarray(bg, "RGBA")

    # Left panel: full_cutout on dark checkerboard
    board.alpha_composite(Image.fromarray(rgba, "RGBA"), (0, 0))

    # Middle panel: reassembled 10 layered parts on dark checkerboard
    assembled = Image.new("RGBA", (w2, h2), (0, 0, 0, 0))
    for part_name in [
        "back_hair",
        "tail",
        "ribbon_left",
        "ribbon_right",
        "body",
        "ear_left",
        "ear_right",
        "head",
        "star_left",
        "star_right",
    ]:
        assembled.alpha_composite(Image.open(LAYERS_DIR / f"{part_name}.png").convert("RGBA"))
    board.alpha_composite(assembled, (w2, 0))

    # Right panel: 6 expression previews stacked vertically
    expr_list = ["expr_blink_half", "expr_blink_closed", "expr_smile", "expr_sleep", "expr_shy", "expr_sweat"]
    for idx, ex_name in enumerate(expr_list):
        head_copy = Image.fromarray(head_rgba, "RGBA")
        head_copy.alpha_composite(Image.open(LAYERS_DIR / f"{ex_name}.png").convert("RGBA"))
        face_crop = head_copy.crop((245, 55, 575, 345)).resize((200, 176), Image.Resampling.LANCZOS)
        py = 24 + idx * 238
        px = w2 * 2 + 100
        board.alpha_composite(face_crop, (px, py))
        ImageDraw.Draw(board).text((px, py + 180), ex_name, fill=(235, 226, 255, 255))

    dboard = ImageDraw.Draw(board)
    dboard.text((16, 16), "1. Full Cutout (Dark Checker)", fill=(255, 255, 255, 255))
    dboard.text((w2 + 16, 16), "2. Assembled 10 Layers", fill=(160, 240, 255, 255))
    dboard.text((w2 * 2 + 100, 4), "3. Expressions", fill=(255, 210, 245, 255))
    board.save(CHECK_PATH, format="PNG", optimize=True)
    print(f"[slice] Exported {len(layers_meta)} layers + {len(expr_meta)} expressions -> {LAYERS_DIR}")
    print(f"[slice] Verification board -> {CHECK_PATH}")


if __name__ == "__main__":
    main()
