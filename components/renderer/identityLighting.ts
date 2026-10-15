import { identityLightSites, identityLightTargets, type IdentityLightFamily } from '../identityForestLight.ts';
import { guardViewCallback } from '../viewErrorHandling.ts';

interface IdentityForestLightContext {
  container: HTMLDivElement | null;
  svg: SVGSVGElement | null;
  identityForestLightFamilies: IdentityLightFamily[];
  reportViewError: (error: unknown) => void;
}

/** Canvas resources belong to one rendered frame and repaint only after geometry changes. */
export function createIdentityForestLight({ container, svg, identityForestLightFamilies, reportViewError }: IdentityForestLightContext) {
  let refresh: (() => void) | null = null;
  let forestLightFrame: number | null = null;
  let forestLightCanvas: HTMLCanvasElement | null = null;
  let forestLightResize: ResizeObserver | null = null;
  const startIdentityForestLight = () => {
    const mount = container;
    const svgElement = svg;
    if (!mount || !svgElement || identityForestLightFamilies.length === 0) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'babel-forest-light-canvas';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.mixBlendMode = 'screen';
    canvas.style.zIndex = '2';
    canvas.style.transition = 'opacity 180ms ease';
    const context = canvas.getContext('2d');
    if (!context) return;
    mount.appendChild(canvas);
    forestLightCanvas = canvas;
    const targets = identityLightTargets(identityForestLightFamilies);

    let baselineTreeScale: number | null = null;
    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(max, value));
    const drawBeam = (
      site: { x: number; y: number },
      source: { x: number; y: number },
      index: number,
      visualScale: number,
      intensity: number
    ) => {
      const dx = site.x - source.x;
      const dy = site.y - source.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / length;
      const ny = dx / length;
      const gradient = context.createLinearGradient(source.x, source.y, site.x, site.y);
      gradient.addColorStop(0, 'rgba(236,253,245,0.30)');
      gradient.addColorStop(0.36, 'rgba(167,243,208,0.15)');
      gradient.addColorStop(1, 'rgba(34,197,94,0.04)');

      [82, 54, 30].forEach((width, widthIndex) => {
        const scaledWidth = width * visualScale;
        const sourceHalf = scaledWidth * 0.18;
        const targetHalf = scaledWidth * (1.05 + index * 0.08);
        context.beginPath();
        context.moveTo(source.x + nx * sourceHalf, source.y + ny * sourceHalf);
        context.lineTo(site.x + nx * targetHalf, site.y + ny * targetHalf);
        context.lineTo(site.x - nx * targetHalf, site.y - ny * targetHalf);
        context.lineTo(source.x - nx * sourceHalf, source.y - ny * sourceHalf);
        context.closePath();
        context.globalAlpha = [0.12, 0.16, 0.22][widthIndex] * intensity;
        context.fillStyle = gradient;
        context.fill();
      });
    };
    const drawDapple = (
      site: { x: number; y: number },
      index: number,
      visualScale: number,
      intensity: number
    ) => {
      context.globalAlpha = 0.22 * intensity;
      const fragments = [
        [-36, -20, 28, 10, -18, 0.30],
        [-10, -34, 18, 7, -34, 0.28],
        [24, -14, 34, 12, -22, 0.34],
        [42, 16, 20, 8, -28, 0.24],
        [-26, 20, 26, 9, -15, 0.26],
        [8, 24, 19, 7, -30, 0.22]
      ];
      fragments.forEach(([x, y, rx, ry, angle, alpha]) => {
        context.save();
        context.translate(
          site.x + (x + (index - 1) * 8) * visualScale,
          site.y + (y - index * 3) * visualScale
        );
        context.rotate((angle * Math.PI) / 180);
        const scaledRx = rx * visualScale;
        const scaledRy = ry * visualScale;
        const dappleGradient = context.createRadialGradient(0, 0, 1, 0, 0, scaledRx);
        dappleGradient.addColorStop(0, `rgba(236,253,245,${alpha})`);
        dappleGradient.addColorStop(0.55, `rgba(167,243,208,${alpha * 0.55})`);
        dappleGradient.addColorStop(1, 'rgba(16,185,129,0)');
        context.fillStyle = dappleGradient;
        context.beginPath();
        context.ellipse(0, 0, scaledRx, scaledRy, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
      });
    };

    const redraw = guardViewCallback(() => {
      forestLightFrame = null;
      if (!canvas.isConnected) return;
      const mountRect = mount.getBoundingClientRect();
      const treeGroup = svgElement.querySelector<SVGGElement>('g');
      const treeMatrix = treeGroup?.getScreenCTM();
      if (!mountRect.width || !mountRect.height || !treeMatrix) return;
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.ceil(mountRect.width * ratio));
      const pixelHeight = Math.max(1, Math.ceil(mountRect.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      canvas.style.width = `${mountRect.width}px`;
      canvas.style.height = `${mountRect.height}px`;
      canvas.style.opacity = '1';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, mountRect.width, mountRect.height);
      context.globalCompositeOperation = 'screen';

      const treeScale = Math.max(0.001, Math.hypot(treeMatrix.a, treeMatrix.b));
      if (baselineTreeScale === null) baselineTreeScale = treeScale;
      const visualScale = clamp(treeScale / baselineTreeScale, 0.82, 2.25);
      const source = { x: mountRect.width * 0.78, y: Math.max(24, mountRect.height * 0.12) };
      identityLightSites(svgElement, mountRect, targets.map(target => [target.nodeId]))
        .forEach((sites, targetIndex) => {
          const { index, intensity } = targets[targetIndex];
          for (const site of sites) {
            drawBeam(site, source, index, visualScale, intensity);
            drawDapple(site, index, visualScale, intensity);
          }
        });
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }, reportViewError);
    // Lighting is static between camera, viewport and Replay changes.
    refresh = () => {
      if (forestLightFrame === null) forestLightFrame = window.requestAnimationFrame(redraw);
    };
    forestLightResize = new ResizeObserver(refresh);
    forestLightResize.observe(mount);
    redraw();
  };

  return {
    start: startIdentityForestLight,
    refresh: () => refresh?.(),
    dispose() {
      if (forestLightFrame !== null) window.cancelAnimationFrame(forestLightFrame);
      refresh = null;
      forestLightResize?.disconnect();
      forestLightCanvas?.remove();
    }
  };
}
