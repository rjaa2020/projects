'use strict';

// Renders the standalone "Transcribe" page: paste a YouTube URL, browse it,
// then mark/name/save loop regions on a waveform and practice them at a
// pitch-preserved slower speed. All of the interesting behavior here is
// client-side (wavesurfer.js + fetch calls to the routes registered in
// server.js) since a waveform/loop editor doesn't fit the rest of the app's
// server-rendered-form pattern.
function renderTranscribePage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Woodshed Transcribe</title>
    <link rel="stylesheet" href="/public/styles.css" />
    <script src="https://unpkg.com/wavesurfer.js@7"></script>
    <script src="https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.min.js"></script>
    <script src="/public/transcribeTime.js"></script>
  </head>
  <body>
    <main class="container">
      <h1>Woodshed</h1>
      <p class="subtitle">Transcribe: loop and slow down a jazz solo</p>
      <nav class="top-nav">
        <a href="/quiz">Chord Quiz</a>
        <a href="/" class="active">Transcribe</a>
      </nav>

      <section class="transcribe-panel">
        <form id="fetchForm" autocomplete="off">
          <label for="youtubeUrl">YouTube URL</label>
          <input id="youtubeUrl" name="youtubeUrl" type="text" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off" required />
          <div class="actions">
            <button type="submit" id="fetchButton">Fetch Audio</button>
          </div>
        </form>
        <p id="fetchStatus" class="footer-note"></p>

        <div id="cookiesUploadSection" hidden>
          <p class="footer-note">
            If that failed because YouTube is blocking this server ("Sign in to
            confirm you're not a bot"), upload a YouTube cookies.txt to authenticate
            as your account. Export only your <strong>youtube.com</strong> cookies
            (a browser extension like "Get cookies.txt LOCALLY" can filter to just
            that site) — nothing else is needed. This isn't stored anywhere
            persistent, so it'll need re-uploading if this app restarts.
          </p>
          <div class="actions">
            <input type="file" id="cookiesFileInput" accept=".txt" />
            <button type="button" id="uploadCookiesButton">Upload cookies.txt</button>
          </div>
          <p id="cookiesUploadStatus" class="footer-note"></p>
        </div>

        <div id="browseSection" hidden>
          <h2>Browse</h2>
          <p class="footer-note">Find the solo you want to transcribe, then switch to the loop/slow view below. Audio here plays through YouTube; it's just for finding your spot.</p>
          <div class="video-embed-wrap">
            <iframe id="browseFrame" class="video-embed" allow="autoplay; encrypted-media" allowfullscreen></iframe>
          </div>
          <div class="actions">
            <button type="button" id="startLoopingButton">Mark a loop &darr;</button>
          </div>
        </div>

        <div id="loopSection" hidden>
          <h2>Loop &amp; Slow</h2>
          <p class="footer-note">Drag on the waveform to mark a phrase. Loop plays it back on repeat; speed presets keep pitch true.</p>
          <div id="waveform" class="waveform"></div>

          <div class="transport">
            <button type="button" id="playPauseButton" class="play-pause-button" aria-label="Play">&#9654;</button>
            <span id="currentTimeLabel" class="time-label">0:00</span>
            <input type="range" id="scrubBar" class="scrub-bar" min="0" max="0" step="0.01" value="0" aria-label="Seek playback position" />
            <span id="durationLabel" class="time-label">0:00</span>
          </div>

          <div class="actions">
            <label class="loop-toggle"><input type="checkbox" id="loopToggle" checked /> Loop this section when it plays through</label>
          </div>

          <p id="loopRangeDisplay" class="loop-range-display">No loop marked yet — drag on the waveform to mark one.</p>

          <p class="control-label">Speed</p>
          <div id="speedPresets" class="speed-presets"></div>

          <div class="save-loop-row">
            <label class="sr-only" for="loopNameInput">Loop name</label>
            <input id="loopNameInput" type="text" placeholder="Name this phrase (e.g. turnaround bar 9-12)" maxlength="60" />
            <button type="button" id="saveLoopButton">Save Loop</button>
          </div>
          <p id="loopStatus" class="footer-note"></p>

          <h3>Saved Loops</h3>
          <ul id="loopList" class="loop-list"></ul>
        </div>
      </section>
    </main>

    <script>
      document.addEventListener('DOMContentLoaded', () => {
        const fetchForm = document.getElementById('fetchForm');
        const fetchButton = document.getElementById('fetchButton');
        const fetchStatus = document.getElementById('fetchStatus');
        const cookiesUploadSection = document.getElementById('cookiesUploadSection');
        const cookiesFileInput = document.getElementById('cookiesFileInput');
        const uploadCookiesButton = document.getElementById('uploadCookiesButton');
        const cookiesUploadStatus = document.getElementById('cookiesUploadStatus');
        const browseSection = document.getElementById('browseSection');
        const browseFrame = document.getElementById('browseFrame');
        const startLoopingButton = document.getElementById('startLoopingButton');
        const loopSection = document.getElementById('loopSection');
        const playPauseButton = document.getElementById('playPauseButton');
        const loopToggle = document.getElementById('loopToggle');
        const speedPresetsEl = document.getElementById('speedPresets');
        const loopNameInput = document.getElementById('loopNameInput');
        const saveLoopButton = document.getElementById('saveLoopButton');
        const loopStatus = document.getElementById('loopStatus');
        const loopListEl = document.getElementById('loopList');
        const loopRangeDisplay = document.getElementById('loopRangeDisplay');
        const currentTimeLabel = document.getElementById('currentTimeLabel');
        const durationLabel = document.getElementById('durationLabel');
        const scrubBar = document.getElementById('scrubBar');

        let currentVideoId = null;
        let speedPresets = [100];
        let currentSpeed = 100;
        let wavesurfer = null;
        let regions = null;
        let activeRegion = null;
        // True while the user is actively dragging the scrub bar's thumb, so
        // playback progress (which also drives the scrub bar) doesn't fight
        // the drag.
        let isScrubbing = false;

        // Caches the decoded audio Blob for each speed preset once fetched,
        // so switching speeds swaps the already-in-memory audio via
        // wavesurfer.loadBlob() instead of re-fetching over the network and
        // waiting on a fresh decode — that round trip was the main source of
        // the "jump" when changing speeds. Cleared whenever a new video is
        // fetched. Values are Promises so concurrent requests for the same
        // speed share one fetch instead of racing.
        let audioBlobCache = new Map();

        // Thin wrappers around the shared TranscribeTime module (loaded via
        // <script src="/public/transcribeTime.js">) that close over the
        // currently-selected speed, since every call site here converts
        // relative to "whatever speed is loaded right now".
        function toOriginalSeconds(localSeconds) {
          return TranscribeTime.toOriginalSeconds(localSeconds, currentSpeed);
        }

        function toLocalSeconds(originalSeconds) {
          return TranscribeTime.toLocalSeconds(originalSeconds, currentSpeed);
        }

        function formatSeconds(totalSeconds) {
          return TranscribeTime.formatSeconds(totalSeconds);
        }

        // Updates the current-time/duration labels, always in the *original*
        // (100%-speed) timeline so the numbers mean the same thing regardless
        // of which speed preset is currently loaded. The scrub bar itself
        // operates directly in the *local* (currently-loaded file's) timeline
        // since it drives wavesurfer.setTime()/getCurrentTime() 1:1 — while
        // the user is dragging it, we skip overwriting its value here so the
        // drag doesn't get fought by playback-driven updates.
        function updateTimeDisplay() {
          if (!wavesurfer) {
            currentTimeLabel.textContent = '0:00';
            durationLabel.textContent = '0:00';
            return;
          }
          const currentLocal = wavesurfer.getCurrentTime();
          const durationLocal = wavesurfer.getDuration() || 0;
          currentTimeLabel.textContent = formatSeconds(toOriginalSeconds(currentLocal));
          durationLabel.textContent = formatSeconds(toOriginalSeconds(durationLocal));
          if (!isScrubbing) {
            scrubBar.value = String(currentLocal);
          }
        }

        // Keeps the play/pause button's icon and label in sync with actual
        // playback state, including when it changes for reasons other than
        // clicking the button itself (e.g. reaching the end of the track).
        function updatePlayPauseButton() {
          const isPlaying = Boolean(wavesurfer && wavesurfer.isPlaying());
          playPauseButton.textContent = isPlaying ? '⏸' : '▶';
          playPauseButton.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
        }

        // Updates the live loop-region display, converting the region's
        // local-timeline bounds back to the original timeline so a marked
        // loop reads the same no matter what speed you marked it at.
        function updateLoopRangeDisplay() {
          if (!activeRegion) {
            loopRangeDisplay.textContent = 'No loop marked yet — drag on the waveform to mark one.';
            return;
          }
          const startOriginal = toOriginalSeconds(activeRegion.start);
          const endOriginal = toOriginalSeconds(activeRegion.end);
          loopRangeDisplay.textContent = 'Marked loop: ' + TranscribeTime.formatTimeRange(startOriginal, endOriginal);
        }

        fetchForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const url = document.getElementById('youtubeUrl').value.trim();
          if (!url) {
            return;
          }
          fetchButton.disabled = true;
          fetchStatus.textContent = 'Fetching audio... this can take a while for the first request on a video.';
          try {
            const response = await fetch('/transcribe/fetch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url })
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || 'Failed to fetch audio.');
            }
            currentVideoId = payload.video_id;
            speedPresets = payload.speed_presets || [100];
            audioBlobCache = new Map();
            fetchStatus.textContent = payload.already_cached
              ? 'Already downloaded — ready to go.'
              : 'Downloaded and cached.';
            cookiesUploadSection.hidden = true;
            browseFrame.src = 'https://www.youtube.com/embed/' + encodeURIComponent(currentVideoId);
            browseSection.hidden = false;
            loopSection.hidden = true;
          } catch (error) {
            fetchStatus.textContent = error.message;
            cookiesUploadSection.hidden = false;
          } finally {
            fetchButton.disabled = false;
          }
        });

        uploadCookiesButton.addEventListener('click', async () => {
          const file = cookiesFileInput.files[0];
          if (!file) {
            cookiesUploadStatus.textContent = 'Choose a cookies.txt file first.';
            return;
          }
          uploadCookiesButton.disabled = true;
          cookiesUploadStatus.textContent = 'Uploading...';
          try {
            const content = await file.text();
            const response = await fetch('/transcribe/cookies', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content })
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || 'Failed to upload cookies.');
            }
            cookiesUploadStatus.textContent = 'Cookies uploaded — try fetching the video again.';
          } catch (error) {
            cookiesUploadStatus.textContent = error.message;
          } finally {
            uploadCookiesButton.disabled = false;
          }
        });

        startLoopingButton.addEventListener('click', () => {
          if (!currentVideoId) {
            return;
          }
          browseFrame.src = '';
          browseSection.hidden = true;
          loopSection.hidden = false;
          renderSpeedPresets();
          initWaveform(100);
          loadLoopList();
          prefetchOtherSpeeds();
        });

        // Fetches (and caches) the audio Blob for one speed preset. Reuses an
        // in-flight or already-resolved fetch for the same speed rather than
        // starting a new one.
        function getAudioBlob(speedPercent) {
          if (!audioBlobCache.has(speedPercent)) {
            const url = '/transcribe/audio/' + encodeURIComponent(currentVideoId) + '?speed=' + speedPercent;
            audioBlobCache.set(speedPercent, fetch(url).then((response) => {
              if (!response.ok) {
                throw new Error('Failed to load audio for ' + speedPercent + '% speed.');
              }
              return response.blob();
            }));
          }
          return audioBlobCache.get(speedPercent);
        }

        // Warms the cache for every speed preset besides the one already
        // loaded, in the background, so that switching speeds later is a
        // local swap instead of a network fetch. Fetch failures here are
        // silently ignored — switchSpeed() will simply re-fetch (and surface
        // any real error) on demand if a prefetch didn't pan out.
        function prefetchOtherSpeeds() {
          speedPresets.forEach((preset) => {
            if (preset !== currentSpeed) {
              getAudioBlob(preset).catch(() => {});
            }
          });
        }

        function renderSpeedPresets() {
          speedPresetsEl.innerHTML = '';
          speedPresets.forEach((preset) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = preset + '%';
            button.className = 'speed-preset-button' + (preset === currentSpeed ? ' active' : '');
            button.addEventListener('click', () => switchSpeed(preset));
            speedPresetsEl.appendChild(button);
          });
        }

        function initWaveform(speedPercent) {
          currentSpeed = speedPercent;
          if (wavesurfer) {
            wavesurfer.destroy();
          }
          wavesurfer = WaveSurfer.create({
            container: '#waveform',
            waveColor: '#9aa5b1',
            progressColor: '#111827',
            height: 110
          });
          regions = WaveSurfer.Regions.create();
          wavesurfer.registerPlugin(regions);

          getAudioBlob(speedPercent)
            .then((blob) => wavesurfer.loadBlob(blob))
            .catch((error) => {
              loopStatus.textContent = error.message;
            });

          wavesurfer.on('ready', () => {
            regions.enableDragSelection({ color: 'rgba(17, 24, 39, 0.15)' });
            scrubBar.max = String(wavesurfer.getDuration() || 0);
            updateTimeDisplay();
            updatePlayPauseButton();
          });

          wavesurfer.on('timeupdate', () => {
            updateTimeDisplay();
          });

          wavesurfer.on('seeking', () => {
            updateTimeDisplay();
          });

          wavesurfer.on('play', updatePlayPauseButton);
          wavesurfer.on('pause', updatePlayPauseButton);
          wavesurfer.on('finish', updatePlayPauseButton);

          regions.on('region-created', (region) => {
            // Only one active (unsaved) loop region at a time.
            Object.values(regions.getRegions ? regions.getRegions() : []).forEach((existing) => {
              if (existing !== region) {
                existing.remove();
              }
            });
            activeRegion = region;
            updateLoopRangeDisplay();
          });

          // Fires continuously while a region is being dragged/resized, so the
          // timestamp display tracks the drag live rather than only updating
          // once the mouse is released.
          regions.on('region-update', (region) => {
            activeRegion = region;
            updateLoopRangeDisplay();
          });

          // Fires once when a drag/resize ends.
          regions.on('region-updated', (region) => {
            activeRegion = region;
            updateLoopRangeDisplay();
          });

          regions.on('region-out', (region) => {
            if (loopToggle.checked && region === activeRegion) {
              region.play();
            }
          });

          updateTimeDisplay();
          updateLoopRangeDisplay();
        }

        async function switchSpeed(speedPercent) {
          if (!wavesurfer || speedPercent === currentSpeed) {
            return;
          }
          const previousRegionOriginal = activeRegion
            ? { start: toOriginalSeconds(activeRegion.start), end: toOriginalSeconds(activeRegion.end) }
            : null;
          // Capture where we are (in the speed-independent original timeline)
          // and whether we were playing, so switching speed doesn't yank
          // playback back to the start of the track.
          const previousPositionOriginal = toOriginalSeconds(wavesurfer.getCurrentTime());
          const wasPlaying = wavesurfer.isPlaying();

          currentSpeed = speedPercent;
          renderSpeedPresets();

          let blob;
          try {
            // Almost always already resolved by prefetchOtherSpeeds() by the
            // time the user clicks a preset, so this is normally a local
            // handoff to loadBlob() rather than a network wait — that's what
            // removes the jump switching speeds used to have.
            blob = await getAudioBlob(speedPercent);
          } catch (error) {
            loopStatus.textContent = error.message;
            return;
          }

          wavesurfer.once('ready', () => {
            if (previousRegionOriginal) {
              activeRegion = regions.addRegion({
                start: toLocalSeconds(previousRegionOriginal.start),
                end: toLocalSeconds(previousRegionOriginal.end),
                color: 'rgba(17, 24, 39, 0.15)',
                drag: true,
                resize: true
              });
            }
            wavesurfer.setTime(toLocalSeconds(previousPositionOriginal));
            if (wasPlaying) {
              wavesurfer.play();
            }
            updateTimeDisplay();
            updateLoopRangeDisplay();
            updatePlayPauseButton();
          });

          await wavesurfer.loadBlob(blob);
        }

        playPauseButton.addEventListener('click', () => {
          if (wavesurfer) {
            wavesurfer.playPause();
          }
        });

        // Scrubbing: dragging (or clicking) the range input seeks live. The
        // 'input' event fires continuously while the thumb is being dragged
        // (and once for a plain click), so this doubles as live scrubbing.
        scrubBar.addEventListener('pointerdown', () => {
          isScrubbing = true;
        });

        scrubBar.addEventListener('input', () => {
          if (!wavesurfer) {
            return;
          }
          const targetLocal = Number(scrubBar.value) || 0;
          wavesurfer.setTime(targetLocal);
          currentTimeLabel.textContent = formatSeconds(toOriginalSeconds(targetLocal));
        });

        scrubBar.addEventListener('change', () => {
          isScrubbing = false;
          updateTimeDisplay();
        });

        saveLoopButton.addEventListener('click', async () => {
          if (!activeRegion) {
            loopStatus.textContent = 'Drag on the waveform to mark a loop first.';
            return;
          }
          const name = loopNameInput.value.trim();
          if (!name) {
            loopStatus.textContent = 'Give this loop a name.';
            return;
          }
          const startSeconds = toOriginalSeconds(activeRegion.start);
          const endSeconds = toOriginalSeconds(activeRegion.end);
          try {
            const response = await fetch('/transcribe/loops/' + encodeURIComponent(currentVideoId), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, startSeconds, endSeconds })
            });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error || 'Failed to save loop.');
            }
            loopNameInput.value = '';
            loopStatus.textContent = 'Saved.';
            loadLoopList();
          } catch (error) {
            loopStatus.textContent = error.message;
          }
        });

        async function loadLoopList() {
          try {
            const response = await fetch('/transcribe/loops/' + encodeURIComponent(currentVideoId));
            const payload = await response.json();
            renderLoopList(Array.isArray(payload.loops) ? payload.loops : []);
          } catch (error) {
            loopListEl.innerHTML = '<li>Could not load saved loops.</li>';
          }
        }

        function renderLoopList(loops) {
          loopListEl.innerHTML = '';
          if (!loops.length) {
            loopListEl.innerHTML = '<li class="footer-note">No saved loops for this video yet.</li>';
            return;
          }
          loops.forEach((loop) => {
            const item = document.createElement('li');
            item.className = 'loop-item';

            const label = document.createElement('span');
            label.textContent = loop.name + ' (' + formatSeconds(loop.startSeconds) + '–' + formatSeconds(loop.endSeconds) + ')';
            item.appendChild(label);

            const loadButton = document.createElement('button');
            loadButton.type = 'button';
            loadButton.textContent = 'Load';
            loadButton.addEventListener('click', () => {
              if (regions) {
                Object.values(regions.getRegions ? regions.getRegions() : []).forEach((existing) => existing.remove());
              }
              activeRegion = regions.addRegion({
                start: toLocalSeconds(loop.startSeconds),
                end: toLocalSeconds(loop.endSeconds),
                color: 'rgba(17, 24, 39, 0.15)',
                drag: true,
                resize: true
              });
              wavesurfer.setTime(toLocalSeconds(loop.startSeconds));
              updateLoopRangeDisplay();
              updateTimeDisplay();
            });
            item.appendChild(loadButton);

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.textContent = 'Delete';
            deleteButton.addEventListener('click', async () => {
              await fetch('/transcribe/loops/' + encodeURIComponent(currentVideoId) + '/' + encodeURIComponent(loop.id) + '/delete', {
                method: 'POST'
              });
              loadLoopList();
            });
            item.appendChild(deleteButton);

            loopListEl.appendChild(item);
          });
        }
      });
    </script>
  </body>
</html>`;
}

module.exports = { renderTranscribePage };
