import type { IconGlyph } from '@forgekit/contracts';
import { iconGlyphs } from '@forgekit/contracts';
import { renderIconSvg } from '../../engines/icons/render';

export const glyphLabels: Record<IconGlyph, string> = {
  sword: 'Pedang',
  shield: 'Perisai',
  bow: 'Busur',
  axe: 'Kapak',
  skull: 'Tengkorak',
  potion: 'Ramuan',
  coin: 'Koin',
  gem: 'Permata',
  chest: 'Peti',
  key: 'Kunci',
  bag: 'Kantong',
  heart: 'Hati',
  star: 'Bintang',
  spark: 'Kilau',
  flame: 'Api',
  bolt: 'Petir',
  compass: 'Kompas',
  crown: 'Mahkota',
};

export function IconGlyphPicker({
  selected,
  onSelect,
  primaryColor = '#FF405F',
  secondaryColor = '#FFD166',
}: {
  selected: IconGlyph;
  onSelect: (glyph: IconGlyph) => void;
  primaryColor?: string;
  secondaryColor?: string;
}) {
  return (
    <div className="icon-glyph-grid" role="radiogroup" aria-label="Pilih simbol ikon">
      {iconGlyphs.map((glyph) => {
        const miniSvg = renderIconSvg({
          schemaVersion: 1,
          name: glyphLabels[glyph],
          glyph,
          shape: 'none',
          style: 'duotone',
          background: 'transparent',
          primaryColor,
          secondaryColor,
          strokeWidth: 2,
          padding: 2,
          size: 28,
        }).svg;

        const isSelected = selected === glyph;

        return (
          <button
            type="button"
            key={glyph}
            role="radio"
            aria-checked={isSelected}
            aria-label={glyphLabels[glyph]}
            className={`glyph-cell${isSelected ? ' is-selected' : ''}`}
            onClick={() => onSelect(glyph)}
          >
            <span
              className="glyph-mini-preview"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: miniSvg }}
            />
            <span className="glyph-label">{glyphLabels[glyph]}</span>
          </button>
        );
      })}
    </div>
  );
}
