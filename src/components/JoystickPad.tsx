import React, { useMemo, useRef, useState } from "react";
import { PanResponder, View } from "react-native";
import { Text, useTheme } from "react-native-paper";

type Props = {
  size?: number;
  deadzone?: number;
  scale?: number;
  showValues?: boolean;
  label?: string;

  knobColor?: string;
  knobBorderColor?: string;

  onChange: (x: number, y: number, active: boolean) => void;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function round(n: number) {
  return Math.round(n);
}

function hexToRgba(hex: string, alpha: number) {
  const h = (hex || "").trim();
  if (!h.startsWith("#")) return `rgba(255,255,255,${alpha})`;

  let r = 255,
    g = 255,
    b = 255;
  if (h.length === 4) {
    r = parseInt(h[1] + h[1], 16);
    g = parseInt(h[2] + h[2], 16);
    b = parseInt(h[3] + h[3], 16);
  } else if (h.length >= 7) {
    r = parseInt(h.slice(1, 3), 16);
    g = parseInt(h.slice(3, 5), 16);
    b = parseInt(h.slice(5, 7), 16);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

function rgbaFromTheme(color: string | undefined, alpha: number, fallbackDark = true) {
  const c = (color || "").trim();

  if (c.startsWith("#")) return hexToRgba(c, alpha);

  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;

  return fallbackDark ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
}

export default function JoystickPad({
  size = 260,
  deadzone = 20,
  scale = 1.0,
  showValues = true,
  label = "Joystick",
  knobColor,
  knobBorderColor,
  onChange,
}: Props) {
  const theme = useTheme();
  const isDark = !!(theme as any)?.dark;

  const knob = 76;
  const radius = (size - knob) / 2;

  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const activeRef = useRef(false);

  const derived = useMemo(() => {
    const nx = clamp(pos.x / radius, -1, 1);
    const ny = clamp(-pos.y / radius, -1, 1);
    const mag = clamp(Math.sqrt(nx * nx + ny * ny), 0, 1);

    const rawX = round(nx * 255);
    const rawY = round(ny * 255);

    const dzFrac = clamp(deadzone / 100, 0, 1);
    const inDeadzone = mag <= dzFrac;

    const outX = inDeadzone ? 0 : round(rawX * clamp(scale, 0, 1));
    const outY = inDeadzone ? 0 : round(rawY * clamp(scale, 0, 1));

    const angleDeg = (-Math.atan2(ny, nx) * 180) / Math.PI;

    return { nx, ny, mag, rawX, rawY, outX, outY, dzFrac, inDeadzone, angleDeg };
  }, [pos.x, pos.y, radius, deadzone, scale]);

  const onSurface = (theme as any)?.colors?.onSurface as string | undefined;
  const surface = ((theme as any)?.colors?.surface as string | undefined) ?? "#ffffff";
  const surfaceVariant = (theme as any)?.colors?.surfaceVariant as string | undefined;

  const bg = rgbaFromTheme(surfaceVariant ?? surface, isDark ? 0.18 : 0.75, isDark);
  const ring = rgbaFromTheme(onSurface, isDark ? 0.14 : 0.22, isDark);
  const axis = rgbaFromTheme(onSurface, isDark ? 0.12 : 0.20, isDark);
  const textCol = onSurface ?? (isDark ? "#fff" : "#000");

  const arrowLine = rgbaFromTheme(onSurface, isDark ? 0.26 : 0.38, isDark);
  const arrowHeadCol = rgbaFromTheme(onSurface, isDark ? 0.34 : 0.48, isDark);

  const dzBorder = rgbaFromTheme(
    onSurface,
    derived.inDeadzone ? (isDark ? 0.22 : 0.28) : (isDark ? 0.14 : 0.22),
    isDark
  );
  const dzFill = derived.inDeadzone ? rgbaFromTheme(onSurface, isDark ? 0.06 : 0.08, isDark) : "transparent";

  const centerDot = rgbaFromTheme(onSurface, isDark ? 0.20 : 0.28, isDark);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,

        onPanResponderGrant: () => {
          activeRef.current = true;
          setActive(true);
        },

        onPanResponderMove: (_evt, g) => {
          const dx = g.dx;
          const dy = g.dy;

          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const limited = len > radius ? radius / len : 1;

          const lx = dx * limited;
          const ly = dy * limited;

          setPos({ x: lx, y: ly });

          const nx = clamp(lx / radius, -1, 1);
          const ny = clamp(-ly / radius, -1, 1);

          onChange(round(nx * 255), round(ny * 255), true);
        },

        onPanResponderRelease: () => {
          activeRef.current = false;
          setActive(false);
          setPos({ x: 0, y: 0 });
          onChange(0, 0, false);
        },

        onPanResponderTerminate: () => {
          activeRef.current = false;
          setActive(false);
          setPos({ x: 0, y: 0 });
          onChange(0, 0, false);
        },
      }),
    [onChange, radius]
  );

  const inner = size - 28;
  const innerR = inner / 2;
  const dzR = radius * derived.dzFrac;

  const lineThickness = 3;
  const minLen = radius * 0.45;
  const maxLen = radius * 0.95;
  const t = clamp((derived.mag - 0.02) / (1 - 0.02), 0, 1);
  const lineLen = minLen + (maxLen - minLen) * t;

  const arrowHead = 10;
  const showDir = active && !derived.inDeadzone && derived.mag > 0.02;

  const thr = 0.25;
  const upOn = showDir && derived.ny > thr;
  const downOn = showDir && derived.ny < -thr;
  const rightOn = showDir && derived.nx > thr;
  const leftOn = showDir && derived.nx < -thr;

  const onOp = 1.0;
  const offOp = 0.35;

  const primary = (theme as any)?.colors?.primary ?? "#4da3ff";
  const kFill =
    knobColor ??
    hexToRgba(primary, active ? (isDark ? 0.30 : 0.22) : (isDark ? 0.22 : 0.16));
  const kBorder = knobBorderColor ?? hexToRgba(primary, active ? 0.9 : isDark ? 0.7 : 0.8);

  return (
    <View style={{ alignItems: "center", gap: 8 }}>
      <View
        {...pan.panHandlers}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: ring,
          overflow: "hidden",
        }}
      >
        <Text style={{ position: "absolute", top: 10, opacity: 0.75, color: textCol }}>{label}</Text>

        {/* стрелки */}
        <View style={{ position: "absolute", top: 18, alignItems: "center" }}>
          <Text style={{ opacity: upOn ? onOp : offOp, color: textCol }}>▲</Text>
        </View>
        <View style={{ position: "absolute", bottom: 14, alignItems: "center" }}>
          <Text style={{ opacity: downOn ? onOp : offOp, color: textCol }}>▼</Text>
        </View>
        <View style={{ position: "absolute", left: 14, justifyContent: "center" }}>
          <Text style={{ opacity: leftOn ? onOp : offOp, color: textCol }}>◀</Text>
        </View>
        <View style={{ position: "absolute", right: 14, justifyContent: "center" }}>
          <Text style={{ opacity: rightOn ? onOp : offOp, color: textCol }}>▶</Text>
        </View>

        {/* внутренний круг */}
        <View
          style={{
            width: inner,
            height: inner,
            borderRadius: innerR,
            borderWidth: 1,
            borderColor: ring,
          }}
        />

        {/* оси */}
        <View
          style={{
            position: "absolute",
            width: inner,
            height: 1,
            backgroundColor: axis,
          }}
        />
        <View
          style={{
            position: "absolute",
            height: inner,
            width: 1,
            backgroundColor: axis,
          }}
        />

        {/* deadzone */}
        <View
          style={{
            position: "absolute",
            width: dzR * 2,
            height: dzR * 2,
            borderRadius: dzR,
            borderWidth: 1,
            borderColor: dzBorder,
            backgroundColor: dzFill,
          }}
        />

        {/* стрелка направления */}
        {showDir ? (
          <View
            style={{
              position: "absolute",
              left: size / 2 - lineLen / 2,
              top: size / 2 - arrowHead / 2,
              width: lineLen,
              height: arrowHead,
              transform: [{ rotate: `${derived.angleDeg}deg` }],
            }}
          >
            <View
              style={{
                position: "absolute",
                left: lineLen / 2,
                top: (arrowHead - lineThickness) / 2,
                width: Math.max(0, lineLen / 2 - arrowHead),
                height: lineThickness,
                borderRadius: 999,
                backgroundColor: arrowLine,
              }}
            />
            <View
              style={{
                position: "absolute",
                left: Math.max(0, lineLen - arrowHead),
                top: 0,
                width: 0,
                height: 0,
                borderTopWidth: arrowHead / 2,
                borderBottomWidth: arrowHead / 2,
                borderLeftWidth: arrowHead,
                borderTopColor: "transparent",
                borderBottomColor: "transparent",
                borderLeftColor: arrowHeadCol,
              }}
            />
          </View>
        ) : null}

        {/* “палец” */}
        <View
          style={{
            position: "absolute",
            width: knob,
            height: knob,
            borderRadius: knob / 2,
            transform: [{ translateX: pos.x }, { translateY: pos.y }],

            backgroundColor: kFill,
            borderWidth: 2,
            borderColor: kBorder,

            elevation: active ? 6 : 2,
            shadowOpacity: active ? 0.35 : 0.2,
            shadowRadius: active ? 10 : 6,
            shadowOffset: { width: 0, height: 3 },
          }}
        />

        {/* центр */}
        <View
          style={{
            position: "absolute",
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: derived.inDeadzone && active ? rgbaFromTheme(onSurface, isDark ? 0.32 : 0.36, isDark) : centerDot,
          }}
        />
      </View>

      {showValues ? (
        <View style={{ alignItems: "center" }}>
          <Text style={{ opacity: 0.75, color: textCol }}>
            X {derived.outX} • Y {derived.outY} • {Math.round(derived.mag * 100)}%
            {derived.inDeadzone ? " • deadzone" : ""}
          </Text>
          <Text style={{ opacity: 0.55, fontSize: 12, color: textCol }}>
            raw: {derived.rawX}/{derived.rawY} • scale: {String(scale)} • dz: {String(deadzone)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
