/* Vutto Attendance — punch proof helpers.
   Location + a selfie are required for every punch, and the location is
   re-sent periodically while the employee is on the clock. */

const CAPTURE = (() => {

  /* ---------------- location ---------------- */
  function getPosition({ timeout = 20000, highAccuracy = true } = {}) {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('This device does not support location.'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        (err) => {
          const msg = err.code === 1
            ? 'Location permission is required to punch in/out. Please allow location access.'
            : err.code === 3 ? 'Could not get your location in time. Please try again.'
            : 'Could not get your location. Please try again.';
          reject(new Error(msg));
        },
        { enableHighAccuracy: highAccuracy, timeout, maximumAge: 0 },
      );
    });
  }

  /** Best-effort human-readable address (free OSM service; falls back to null). */
  async function reverseGeocode(lat, lng, timeout = 5000) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeout);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16`,
        { signal: ctl.signal, headers: { Accept: 'application/json' } },
      );
      clearTimeout(t);
      if (!res.ok) return null;
      const j = await res.json();
      return j.display_name ? String(j.display_name).slice(0, 280) : null;
    } catch { return null; }
  }

  /* ---------------- camera ---------------- */
  function buildCameraModal() {
    if (document.getElementById('cam-modal')) return;
    const el = document.createElement('div');
    el.className = 'modal-bg';
    el.id = 'cam-modal';
    el.innerHTML = `
      <div class="modal cam-modal">
        <h2>Take a selfie</h2>
        <p class="small muted" id="cam-hint">A photo is required for every punch.</p>
        <div class="cam-frame">
          <video id="cam-video" autoplay playsinline muted></video>
          <canvas id="cam-canvas" hidden></canvas>
          <div class="cam-status" id="cam-status">Starting camera…</div>
        </div>
        <input id="cam-file" type="file" accept="image/*" capture="user" hidden />
        <div class="foot">
          <button class="btn ghost" id="cam-cancel" type="button">Cancel</button>
          <button class="btn ghost" id="cam-upload" type="button">Upload instead</button>
          <button class="btn primary" id="cam-shot" type="button" disabled>Capture</button>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  function shrinkToDataUrl(source, w, h, maxW = 480, quality = 0.6) {
    const scale = Math.min(1, maxW / w);
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    canvas.getContext('2d').drawImage(source, 0, 0, cw, ch);
    return canvas.toDataURL('image/jpeg', quality);
  }

  function capturePhoto() {
    buildCameraModal();
    const modal = document.getElementById('cam-modal');
    const video = document.getElementById('cam-video');
    const status = document.getElementById('cam-status');
    const shot = document.getElementById('cam-shot');
    const file = document.getElementById('cam-file');
    modal.classList.add('open');

    let stream = null;
    let done = false;

    const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    const finish = (value, err) => {
      if (done) return;
      done = true;
      stop();
      modal.classList.remove('open');
      shot.onclick = null; modal.querySelector('#cam-cancel').onclick = null;
      document.getElementById('cam-upload').onclick = null;
      file.onchange = null;
      err ? reject(err) : resolve(value);
    };
    let resolve, reject;
    const p = new Promise((res, rej) => { resolve = res; reject = rej; });

    modal.querySelector('#cam-cancel').onclick = () => finish(null, new Error('A photo is required to punch in or out.'));

    // Upload fallback (works when the camera API is blocked).
    document.getElementById('cam-upload').onclick = () => file.click();
    file.onchange = () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => finish(shrinkToDataUrl(img, img.naturalWidth, img.naturalHeight));
      img.onerror = () => finish(null, new Error('Could not read that image.'));
      img.src = URL.createObjectURL(f);
    };

    shot.onclick = () => {
      if (!video.videoWidth) return;
      finish(shrinkToDataUrl(video, video.videoWidth, video.videoHeight));
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
        video.srcObject = stream;
        await video.play().catch(() => {});
        status.textContent = '';
        status.style.display = 'none';
        shot.disabled = false;
      } catch (e) {
        status.textContent = 'Camera unavailable — use "Upload instead".';
        document.getElementById('cam-upload').classList.add('primary');
      }
    })();

    return p;
  }

  /** Collect everything a punch needs: location, address and a selfie. */
  async function punchProof(onStep = () => {}) {
    onStep('Getting your location…');
    const pos = await getPosition();
    onStep('Taking your photo…');
    const photo = await capturePhoto();
    onStep('Checking where you are…');
    const address = await reverseGeocode(pos.lat, pos.lng);
    return { ...pos, address, photo };
  }

  /* ---------------- periodic tracking ---------------- */
  /** Call `onPing` every `minutes` while the tab is open. Returns a stop fn. */
  function startTracking(minutes, onPing) {
    let timer = null;
    const tick = async () => {
      try {
        if (document.visibilityState !== 'visible') return;   // don't ping in the background
        const perm = await navigator.permissions?.query?.({ name: 'geolocation' }).catch(() => null);
        if (perm && perm.state !== 'granted') return;          // never prompt on a timer
        const pos = await getPosition({ timeout: 15000, highAccuracy: false });
        const address = await reverseGeocode(pos.lat, pos.lng);
        await onPing({ ...pos, address });
      } catch { /* stay quiet — tracking is best effort */ }
    };
    const start = () => { if (!timer) timer = setInterval(tick, minutes * 60 * 1000); };
    const stop = () => { clearInterval(timer); timer = null; };
    start();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
    return { stop, tickNow: tick };
  }

  return { getPosition, reverseGeocode, capturePhoto, punchProof, startTracking };
})();
