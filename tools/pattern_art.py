"""Make pixel-art pictures for pattern requests with the local ComfyUI + FLUX in C:\\Projects\\LocalIllustrator.

Uses that folder's ComfyUI and models as they are (nothing there is changed): if a ComfyUI is already listening
on the illustrator's port it is used; otherwise one is started the same way the illustrator starts it, and stopped
again when this is done. Models are unloaded afterwards so the GPU is free for other apps.

  <LocalIllustrator>\\.venv\\Scripts\\python.exe tools/pattern_art.py "a monkey eating a banana" --grid 50x60 --n 4 --out <folder> [--model schnell]

Model: FLUX.2 [klein] by default (follows the request closely, bold shapes, fewer yarns); --model schnell for more detail.
With klein, the PixelArt Redmond LoRA is on by default (strength 0.8; --pixel 0 turns it off). It is kept in %USERPROFILE%\\.row-by-row\\models\\loras, outside
LocalIllustrator; ComfyUI only sees it when this script starts ComfyUI itself, otherwise plain klein is used.
With it every option lands at 6 to 10 colors and looks more like real pixel art, but each picture takes ~35 s.
Writes <out>/option-<n>.png for each seed. Turn the one you like into a pattern with tools/art_to_pattern.py.
"""
import argparse, json, math, os, subprocess, sys, time, urllib.request
from pathlib import Path

LI = Path(r"C:\Projects\LocalIllustrator")
COMFY_DIR, COMFY_OUT, PORT = LI / "ComfyUI", LI / "comfy_output", 8189
BASE = f"http://127.0.0.1:{PORT}"
MODELS = Path.home() / ".row-by-row" / "models"            # our own add-ons, so nothing in LocalIllustrator changes
PIXEL_LORA, PIXEL_TRIGGER = "pixelart-redmond-klein9b.safetensors", "Pixel Art, PixArFK. "
STYLE = ("Pixel art sprite, 8-bit retro game style with large chunky square pixels, a single subject, full body, centered, "
         "facing the viewer, thick clean black outline, flat solid colors with no gradients, at most 8 colors, "
         "plain flat white background, no text, no border, no shadow on the ground. Subject: ")


def api(path, data=None, timeout=10):
    req = urllib.request.Request(BASE + path, data=None if data is None else json.dumps(data).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    return json.loads(body) if body[:1] in (b"{", b"[") else body


def up():
    try:
        api("/system_stats", timeout=2); return True
    except (OSError, ValueError):
        return False


def paths_config():
    """A ComfyUI extra-model-paths file pointing at ~/.row-by-row/models (written here, not in LocalIllustrator)."""
    f = MODELS.parent / "comfy_paths.yaml"
    f.write_text(f"rowbyrow:\n    base_path: {MODELS.as_posix()}\n    loras: loras\n", encoding="utf-8")
    return f


def has_lora(name):
    info = api("/object_info/LoraLoaderModelOnly")
    return name in info["LoraLoaderModelOnly"]["input"]["required"]["lora_name"][0]


def start_comfy():
    """Start ComfyUI like the illustrator does (same port, output folder and memory flags)."""
    COMFY_OUT.mkdir(exist_ok=True)
    log = open(LI / "logs" / "comfyui.log", "a", encoding="utf-8")
    proc = subprocess.Popen([str(LI / ".venv" / "Scripts" / "python.exe"), "main.py", "--listen", "127.0.0.1", "--port", str(PORT),
                             "--output-directory", str(COMFY_OUT), "--reserve-vram", "2", "--disable-auto-launch", "--disable-dynamic-vram",
                             "--extra-model-paths-config", str(paths_config())],
                            cwd=COMFY_DIR, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                            creationflags=subprocess.CREATE_NO_WINDOW, env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    for _ in range(240):
        if proc.poll() is not None: sys.exit(f"ComfyUI exited with code {proc.returncode}; see {LI / 'logs' / 'comfyui.log'}")
        if up(): return proc
        time.sleep(0.5)
    proc.kill(); sys.exit("ComfyUI didn't start within 2 minutes")


def workflow(prompt, w, h, seed):
    """FLUX.1 [schnell], 4 steps (the illustrator's fast workflow, without its custom nodes)."""
    return {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "flux1-schnell-fp8.safetensors"}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["ckpt", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["ckpt", 1]}},
        "latent": {"class_type": "EmptySD3LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "sample": {"class_type": "KSampler", "inputs": {"model": ["ckpt", 0], "positive": ["pos", 0], "negative": ["neg", 0],
                   "latent_image": ["latent", 0], "seed": seed, "steps": 4, "cfg": 1.0, "sampler_name": "euler",
                   "scheduler": "simple", "denoise": 1.0}},
        "decode": {"class_type": "VAEDecode", "inputs": {"samples": ["sample", 0], "vae": ["ckpt", 2]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": "rowbyrow"}},
    }


def klein_workflow(prompt, w, h, seed, pixel=0.0):
    """FLUX.2 [klein] 9B, 4 steps: its own Qwen3 text encoder and VAE (the illustrator's klein workflow, without its custom nodes)."""
    return {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux-2-klein-9b.safetensors", "weight_dtype": "fp8_e4m3fn"}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_8b_fp8mixed.safetensors", "type": "flux2", "device": "default"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["clip", 0]}},
        "neg": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["pos", 0]}},
        "latent": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "sched": {"class_type": "Flux2Scheduler", "inputs": {"steps": 4, "width": w, "height": h}},
        "noise": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "sampler": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "guider": {"class_type": "CFGGuider", "inputs": {"model": ["lora" if pixel else "unet", 0], "positive": ["pos", 0], "negative": ["neg", 0], "cfg": 1.0}},
        "sample": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["noise", 0], "guider": ["guider", 0], "sampler": ["sampler", 0],
                   "sigmas": ["sched", 0], "latent_image": ["latent", 0]}},
        "decode": {"class_type": "VAEDecodeTiled", "inputs": {"samples": ["sample", 0], "vae": ["vae", 0], "tile_size": 512,
                   "overlap": 64, "temporal_size": 64, "temporal_overlap": 8}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["decode", 0], "filename_prefix": "rowbyrow"}},
    } | ({"lora": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["unet", 0], "lora_name": PIXEL_LORA,
                                                                    "strength_model": pixel}}} if pixel else {})


def run(prompt, w, h, seed, model="klein", pixel=0.0):
    if pixel: prompt = PIXEL_TRIGGER + prompt
    wf = klein_workflow(prompt, w, h, seed, pixel) if model == "klein" else workflow(prompt, w, h, seed)
    pid = api("/prompt", {"prompt": wf})["prompt_id"]
    for _ in range(600):
        hist = api(f"/history/{pid}")
        if pid in hist:
            st = hist[pid].get("status", {})
            if st.get("status_str") == "error": sys.exit(f"ComfyUI error: {json.dumps(st)[:500]}")
            for out in hist[pid].get("outputs", {}).values():
                for im in out.get("images", []):
                    # with the LoRA, a second picture on a model that stays loaded spills past 24 GB and crawls: unload each time
                    if pixel: api("/free", {"unload_models": True, "free_memory": True})
                    return COMFY_OUT / im.get("subfolder", "") / im["filename"]
        time.sleep(0.5)
    sys.exit("timed out waiting for the picture")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("subject"); ap.add_argument("--grid", default="50x60"); ap.add_argument("--n", type=int, default=4)
    ap.add_argument("--seed", type=int, default=1); ap.add_argument("--out", required=True)
    ap.add_argument("--model", choices=["klein", "schnell"], default="klein")   # klein follows requests closely and needs fewer yarns
    ap.add_argument("--pixel", type=float, default=0.8)   # PixelArt Redmond LoRA strength (klein only); 0 turns it off
    a = ap.parse_args()
    if a.model != "klein": a.pixel = 0.0
    cols, rows = map(int, a.grid.lower().split("x"))
    # about a megapixel in the pattern's shape, in multiples of 16
    w = round(math.sqrt(1_000_000 * cols / rows) / 16) * 16; h = round(w * rows / cols / 16) * 16
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    proc = None if up() else start_comfy()
    if a.pixel and not has_lora(PIXEL_LORA):
        print(f"note: ComfyUI is already running without {PIXEL_LORA}, so this is plain klein "
              f"(the LoRA belongs in {MODELS / 'loras'} and needs this script to start ComfyUI)"); a.pixel = 0.0
    try:
        for i in range(a.n):
            t = time.time(); src = run(STYLE + a.subject, w, h, a.seed + i, a.model, a.pixel)
            dest = out / f"option-{i + 1}.png"; dest.write_bytes(src.read_bytes())
            print(f"{dest}  ({a.model}{f' + pixel {a.pixel}' if a.pixel else ''}, {w}x{h}, seed {a.seed + i}, {time.time() - t:.1f} s)")
    finally:
        try: api("/free", {"unload_models": True, "free_memory": True})
        except Exception: pass
        if proc: proc.terminate()


if __name__ == "__main__":
    main()
