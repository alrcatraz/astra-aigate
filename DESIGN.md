# Design System: Expo

> **Hermes Agent — Implementation Notes**
>
> The original site uses proprietary fonts. For self-contained HTML output, use these CDN substitutes:
>
> - **Primary:** `Inter` | **Mono:** `JetBrains Mono`
> - **Font stack (CSS):** `font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;`
> - **Mono stack (CSS):** `font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;`
>
> ```html
> <link
>   href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
>   rel="stylesheet"
> />
> ```
>
> Use `write_file` to create HTML, serve via `generative-widgets` skill (cloudflared tunnel).
> Verify visual accuracy with `browser_vision` after generating.

## 1. Visual Theme & Atmosphere

Expo's interface is a luminous, confidence-radiating developer platform built on the premise that tools for building apps should feel as polished as the apps themselves. The entire experience lives on a bright, airy canvas — a cool-tinted off-white (`#f0f0f3`) that gives the page a subtle technological coolness without the starkness of pure white. This is a site that breathes: enormous vertical spacing between sections creates a gallery-like pace where each feature gets its own "room."

The design language is decisively monochromatic — pure black (`#000000`) headlines against the lightest possible backgrounds, with a spectrum of cool blue-grays (`#60646c`, `#b0b4ba`, `#555860`) handling all secondary communication. Color is almost entirely absent from the interface itself; when it appears, it's reserved for product screenshots, app icons, and the React universe illustration — making the actual content burst with life against the neutral canvas.

What makes Expo distinctive is its pill-shaped geometry. Buttons, tabs, video containers, and even the entire hero section wrappers use pill-like rounded corners — creating an interface that feels organic and approachable despite its technical subject matter. The pill shape is Expo's signature, appearing everywhere from primary CTAs to the giant 112px "Get started" button on the landing page.

The typographic voice is aggressive and confident: Inter at extreme weights (500, 600, 700, 900) with tight tracking creates headlines that feel simultaneously compressed and monumental. The 64px hero headline uses -2.76px letter-spacing, creating that signature compressed-modern look. Body text stays at comfortable 15px with open line-height, creating a deliberate contrast between the dramatic headlines and the readable body copy.

## 2. Color Palette

### Core Palette

| Color           | Hex       | Role                                        |
| --------------- | --------- | ------------------------------------------- |
| Cloud Gray      | `#f0f0f3` | Page background — the signature airy canvas |
| Pure White      | `#ffffff` | Card surfaces, elevated containers          |
| Expo Black      | `#000000` | Headlines, primary CTAs, maximum emphasis   |
| Near Black      | `#1c2024` | Body text, readable content                 |
| Slate Gray      | `#60646c` | Secondary text, metadata, captions          |
| Silver          | `#b0b4ba` | Tertiary text, placeholder, disabled        |
| Border Lavender | `#e0e1e6` | Subtle borders, dividers, input edges       |
| Link Cobalt     | `#0d74ce` | Links, interactive text (rare usage)        |

### Semantic Colors

| Color | Hex       | Role                              |
| ----- | --------- | --------------------------------- |
| Green | `#16a34a` | Success states, positive status   |
| Red   | `#dc2626` | Error states, destructive actions |
| Amber | `#f59e0b` | Warnings, pending states          |
| Blue  | `#2563eb` | Info, loading indicators          |

### Color Usage Rules

- **#000000 (Black)** — reserved for headlines, primary CTAs, and the most important UI elements. It carries maximum authority on the light canvas.
- **#f0f0f3 (Cloud Gray)** — the entire site background. Never use white as the page background.
- **#ffffff (White)** — only for elevated card surfaces and content containers on Cloud Gray.
- **#60646c (Slate Gray)** — the default text color for body content, labels, and descriptions.
- **#b0b4ba (Silver)** — for the most subdued elements: placeholders, disabled text, tertiary info.
- **#e0e1e6 (Border Lavender)** — for all borders, dividers, input outlines. Very fine (1px typically).
- Semantic colors (green/red/amber/blue) — ONLY for status indicators and badges. Never as UI chrome.

## 3. Typography

### Font Stack

- **Primary:** Inter (300, 400, 500, 600, 700, 900)
- **Mono:** JetBrains Mono (400, 500)
- **Fallback:** system-ui, -apple-system, Segoe UI, Roboto, sans-serif

### Type Scale

| Element         | Size | Weight | Line Height | Letter Spacing |
| --------------- | ---- | ------ | ----------- | -------------- |
| Hero (h1)       | 64px | 700    | 1.10        | -2.76px        |
| Section (h2)    | 48px | 600    | 1.15        | -1.6px         |
| Card Title (h3) | 20px | 600    | 1.30        | -0.3px         |
| Body            | 15px | 400    | 1.70        | —              |
| Small           | 13px | 400    | 1.50        | —              |
| Caption         | 12px | 500    | 1.33        | 0.4px          |
| Code            | 14px | 400    | 1.60        | —              |

### Typography Rules

- Weight contrast IS the hierarchy — use Inter's full weight range (400–900) rather than size alone to create visual distinction.
- Never use letter-spacing wider than -0.25px on body text — extreme tracking is reserved for display sizes only.
- Code blocks, inline code, and terminal output use JetBrains Mono at 14px.

## 4. Spacing System

### Core Spacing

| Token       | Rem     | Pixels | Context                                    |
| ----------- | ------- | ------ | ------------------------------------------ |
| Micro       | 0.25rem | 4px    | Tiny gaps between inline elements          |
| Tight       | 0.5rem  | 8px    | Between icon and text, badge padding       |
| Comfortable | 0.75rem | 12px   | Input field padding, small gaps            |
| Standard    | 1rem    | 16px   | Card padding, button padding, list spacing |
| Relaxed     | 1.5rem  | 24px   | Between form fields, between card sections |
| Spacious    | 2rem    | 32px   | Between major components                   |
| Section     | 4rem    | 64px   | Between feature sections (minimum)         |
| Gallery     | 6rem    | 96px   | Between major page sections                |

### Layout Principles

- **Generous breathing room is a feature.** Sections are separated by 96px+ of vertical space, creating a gallery-like browsing experience.
- **Don't compress.** If content feels cramped, add space rather than reducing element size.
- **Vertical rhythm is more important than horizontal alignment.** Section spacing dominates over grid precision.

## 5. Corner Radius System

| Token       | Value  | Usage                                        |
| ----------- | ------ | -------------------------------------------- |
| None        | 0px    | Full-width containers, dividers, table cells |
| Soft        | 6px    | Card corners, input fields, ghost buttons    |
| Rounded     | 8px    | Feature cards, code blocks, dialog boxes     |
| Comfortable | 12px   | Large panels, hover states, hero wrappers    |
| Extra       | 16px   | Large modals, elevated panels                |
| Pill        | 9999px | Primary action buttons, tags, avatars        |

### Corner Radius Philosophy

- Pill-shaped (9999px): Primary action buttons, tags, avatars — maximum friendliness

## 6. Depth & Elevation

| Level              | Treatment                                                        | Use                                     |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------- |
| Flat (Level 0)     | No shadow                                                        | Cloud Gray page background, inline text |
| Surface (Level 1)  | White bg, no shadow                                              | Standard white cards on Cloud Gray      |
| Whisper (Level 2)  | `rgba(0,0,0,0.08) 0px 3px 6px` + `rgba(0,0,0,0.07) 0px 2px 4px`  | Subtle card lift, hover states          |
| Elevated (Level 3) | `rgba(0,0,0,0.1) 0px 10px 20px` + `rgba(0,0,0,0.05) 0px 3px 6px` | Feature showcases, product screenshots  |
| Modal (Level 4)    | Dark overlay (--dialog-overlay-background-color) + heavy shadow  | Dialogs, overlays                       |

**Shadow Philosophy**: Expo uses shadows as gentle whispers rather than architectural statements. The primary depth mechanism is **background color contrast** — white cards floating on Cloud Gray — rather than shadow casting. When shadows appear, they're soft, diffused, and directional (downward), creating the feeling of paper hovering millimeters above a desk.

## 7. Do's and Don'ts

### Do

- Use Cloud Gray (`#f0f0f3`) as the page background and Pure White (`#ffffff`) for elevated cards — the two-tone light system is essential
- Keep display headlines at extreme negative letter-spacing (-1.6px to -3px at 64px) for the signature compressed look
- Use pill-shaped (9999px) radius for primary CTA buttons — the organic shape is core to the identity
- Reserve black (`#000000`) for headlines and primary CTAs — it carries maximum authority on the light canvas
- Use Slate Gray (`#60646c`) for secondary text — it's the precise balance between readable and receded
- Maintain enormous vertical spacing between sections (96px+) — the gallery pacing defines the premium feel
- Use product screenshots as the primary visual content — the interface stays monochrome, the products bring color
- Apply Inter at the full weight range (400–900) — weight contrast IS the hierarchy

### Don't

- Don't introduce decorative colors into the interface chrome — the monochromatic palette is intentional
- Don't use sharp corners (border-radius < 6px) on interactive elements — the pill/rounded geometry is the signature
- Don't reduce section spacing below 64px — the breathing room is the design
- Don't use heavy drop shadows — depth comes from background contrast and whisper-soft shadows
- Don't mix in additional typefaces — Inter handles everything from display to caption
- Don't use letter-spacing wider than -0.25px on body text — extreme tracking is reserved for display only
- Don't use borders heavier than 2px — containment is subtle, achieved through background color and gentle borders
- Don't add gradients to the interface — visual richness comes from content, not decoration
- Don't use saturated colors outside of semantic contexts — the palette is strictly grayscale + functional blue

## 8. Responsive Behavior

### Breakpoints

| Name    | Width      | Key Changes                                                            |
| ------- | ---------- | ---------------------------------------------------------------------- |
| Mobile  | <640px     | Single column, hamburger nav, stacked cards, hero text scales to ~36px |
| Tablet  | 640–1024px | 2-column grids, condensed nav, medium hero text                        |
| Desktop | >1024px    | Full multi-column layout, expanded nav, massive hero (64px)            |

_Only one explicit breakpoint detected (640px), suggesting a fluid, container-query or min()/clamp()-based responsive system rather than fixed breakpoint snapping._

### Touch Targets

- Buttons use generous radius (24–36px) creating large, finger-friendly surfaces
- Navigation links spaced with adequate gap
- Status badge sized for touch (36px radius)
- Minimum recommended: 44x44px

### Collapsing Strategy

- **Navigation**: Full horizontal nav with CTA collapses to hamburger on mobile
- **Feature sections**: Multi-column → stacked single column
- **Hero text**: 64px → ~36px progressive scaling
- **Device previews**: Grid → stacked/carousel
- **Cards**: Side-by-side → vertical stacking
- **Spacing**: Reduces proportionally but maintains generous rhythm

### Image Behavior

- Product screenshots scale proportionally
- Device mockups may simplify or show fewer devices on mobile
- Rounded corners maintained at all sizes
- Lazy loading for below-fold content

## 9. Agent Prompt Guide

### Quick Color Reference

- Primary CTA / Headlines: "Expo Black (#000000)"
- Page Background: "Cloud Gray (#f0f0f3)"
- Card Surface: "Pure White (#ffffff)"
- Body Text: "Near Black (#1c2024)"
- Secondary Text: "Slate Gray (#60646c)"
- Borders: "Border Lavender (#e0e1e6)"
- Links: "Link Cobalt (#0d74ce)"
- Tertiary Text: "Silver (#b0b4ba)"

### Example Component Prompts

- "Create a hero section on Cloud Gray (#f0f0f3) with a massive headline at 64px Inter weight 700, line-height 1.10, letter-spacing -3px. Text in Expo Black (#000000). Below, add a subtitle in Slate Gray (#60646c) at 18px. Place a black pill-shaped CTA button (9999px radius) beneath."
- "Design a feature card on Pure White (#ffffff) with a 1px solid Border Lavender (#e0e1e6) border and comfortably rounded corners (8px). Title in Near Black (#1c2024) at 20px Inter weight 600, description in Slate Gray (#60646c) at 16px. Add a whisper shadow (rgba(0,0,0,0.08) 0px 3px 6px)."
- "Build a navigation bar with Expo logo on the left, text links in Near Black (#1c2024) at 14px Inter weight 500, and a black pill CTA button on the right. Background: transparent with blur backdrop. Bottom border: 1px solid Border Lavender (#e0e1e6)."
- "Create a code block using JetBrains Mono at 14px on a Pure White surface with Border Lavender border and 8px radius. Code in Near Black, keywords in Link Cobalt (#0d74ce)."
- "Design a status badge pill (9999px radius) with a green dot and 'All Systems Operational' text in Inter 12px weight 500. Background: Pure White, border: 1px solid Border Lavender."
- "Place a text input in a Cloud Gray form section. White background, 8px radius, 1px Border Lavender border, padding 12px. Label in Slate Gray at 13px weight 500. Focus state: 2px solid Link Cobalt."
