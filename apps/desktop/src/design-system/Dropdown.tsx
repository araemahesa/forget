import { Children, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface Choice { value: string; label: string; disabled: boolean; group?: string }
interface DropdownProps {
  children: ReactNode;
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  title?: string;
  triggerContent?: ReactNode;
  renderChoice?: (choice: Choice) => ReactNode;
  renderGroup?: (group: string) => ReactNode;
  navigateGroups?: boolean;
  onOpenChange?: (open: boolean) => void;
  menuClassName?: string;
  menuMinWidth?: number;
  'aria-label'?: string;
  'aria-describedby'?: string;
}
function textContent(node: ReactNode): string {
  return Children.toArray(node).map((child): string => isValidElement<{ children?: ReactNode }>(child)
    ? textContent(child.props.children) : String(child)).join('');
}
function readChoices(children: ReactNode, disabled = false, group?: string): Choice[] {
  return Children.toArray(children).flatMap((child): Choice[] => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string }>(child)) return [];
    if (child.type === 'option') return [{ value: String(child.props.value ?? textContent(child.props.children)),
      label: textContent(child.props.children), disabled: disabled || !!child.props.disabled, group }];
    return readChoices(child.props.children, disabled || !!child.props.disabled, child.type === 'optgroup' ? child.props.label : group);
  });
}

/** A controlled select with the same value-change contract used by our forms.
 * The trigger keeps focus; its portalled listbox avoids clipped editor panels. */
export function Dropdown({ children, value, onChange, id, name, disabled, required, className = '', title,
  triggerContent, renderChoice, renderGroup, navigateGroups = false, onOpenChange, menuClassName = '', menuMinWidth = 220, ...aria }: DropdownProps) {
  const generatedId = useId();
  const triggerId = id ?? `dropdown-${generatedId}`;
  const listId = `${triggerId}-options`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const allChoices = useMemo(() => readChoices(children), [children]);
  const [group, setGroup] = useState<string | null>(null);
  const groupStage = navigateGroups && group === null;
  const choices: Choice[] = groupStage
    ? [...new Set(allChoices.map(choice => choice.group).filter((name): name is string => !!name))].map(name => ({ value: name, label: name, disabled: allChoices.filter(choice => choice.group === name).every(choice => choice.disabled) }))
    : navigateGroups ? allChoices.filter(choice => choice.group === group) : allChoices;
  const selectedChoice = allChoices.find(choice => choice.value === String(value));
  const selected = choices.findIndex((choice) => choice.value === String(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 320, above: false });
  const search = useRef({ text: '', at: 0 });
  const enabled = choices.map((choice, index) => choice.disabled ? -1 : index).filter((index) => index >= 0);
  const isOpen = open && !disabled && enabled.length > 0;
  const openListener = useRef(onOpenChange);
  openListener.current = onOpenChange;
  useEffect(() => { openListener.current?.(isOpen); }, [isOpen]);
  const optionId = (index: number) => `${listId}-${index}`;
  function show(index = selected) {
    if (disabled || !enabled.length) return;
    trigger.current?.focus({ preventScroll: true });
    setActive(enabled.includes(index) ? index : enabled[0]);
    setOpen(true);
  }
  function choose(index: number) {
    if (!choices[index] || choices[index].disabled) return;
    if (groupStage) {
      setGroup(choices[index].value);
      const accounts = allChoices.filter(choice => choice.group === choices[index].value);
      setActive(Math.max(0, accounts.findIndex(choice => choice.value === String(value))));
      return;
    }
    if (choices[index].value !== String(value)) onChange({ target: { value: choices[index].value } });
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    if (!isOpen || !trigger.current) return;
    const updatePosition = () => {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    // Fixed-position coordinates use the layout viewport, including in WKWebView.
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const below = viewportHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const idealHeight = Math.min(320, renderChoice ? 320 : choices.length * 40 + 12);
    const useAbove = below < idealHeight && above > below;
    const width = Math.min(Math.max(rect.width, menuMinWidth), viewportWidth - 24);
    setPosition({ left: Math.max(12, Math.min(rect.left, viewportWidth - width - 12)),
      top: useAbove ? rect.top - 6 : rect.bottom + 6,
      width, maxHeight: Math.max(40, Math.min(320, useAbove ? above : below)), above: useAbove });
    };
    updatePosition();
    // Keep the list anchored during editor scrolling, including focus-driven scroll.
    const reposition = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) updatePosition();
    };
    document.addEventListener('scroll', reposition, true);
    return () => document.removeEventListener('scroll', reposition, true);
  }, [isOpen, choices.length, menuMinWidth, !!renderChoice]);
  useEffect(() => {
    if (!isOpen) { search.current = { text: '', at: 0 }; setGroup(null); return; }
    const dismiss = (event: Event) => {
      if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    window.addEventListener('resize', close);
    window.addEventListener('hashchange', close);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      window.removeEventListener('resize', close);
      window.removeEventListener('hashchange', close);
    };
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen || !list.current) return;
    const item = document.getElementById(optionId(active));
    if (!item) return;
    const menu = list.current;
    if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight;
  }, [isOpen, active]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  // An asynchronously refreshed catalog may remove the highlighted item.
  const activeIndex = enabled.includes(active) ? active : enabled[0];
  return <span className={`dropdown ${className}`}>
    <button {...aria} ref={trigger} id={triggerId} name={name} value={value} type="button" role="combobox"
      className="dropdown-trigger" disabled={disabled || !choices.length} title={title ?? selectedChoice?.label}
      aria-haspopup="listbox" aria-expanded={isOpen} aria-controls={isOpen ? listId : undefined}
      aria-required={required || undefined} aria-activedescendant={isOpen ? optionId(activeIndex) : undefined}
      onClick={() => isOpen ? setOpen(false) : show()}
      onKeyDown={(event) => {
        if (event.key === 'Tab') { setOpen(false); return; }
        if (event.key === 'Escape' && isOpen) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          if (!isOpen) { show(event.key === 'End' ? enabled.at(-1) : event.key === 'Home' ? enabled[0] : selected); return; }
          const cursor = enabled.indexOf(activeIndex);
          setActive(event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled[enabled.length - 1]
            : enabled[(cursor + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (isOpen) choose(activeIndex); else show();
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const now = Date.now();
          search.current = { text: (now - search.current.at > 700 ? '' : search.current.text) + event.key.toLocaleLowerCase(), at: now };
          const query = search.current.text;
          const match = enabled.find((index) => choices[index].label.toLocaleLowerCase().startsWith(query));
          if (match !== undefined) { event.preventDefault(); show(match); }
        }
      }}>
      <span className="dropdown-value">{triggerContent ?? selectedChoice?.label ?? choices[0]?.label ?? 'Tidak ada pilihan'}</span>
      <Icon name="chevron" />
    </button>
    {isOpen && createPortal(<ul ref={list} id={listId} role="listbox"
      aria-label={aria['aria-label'] ?? trigger.current?.labels?.[0]?.textContent ?? 'Pilihan'}
      className={`dropdown-menu ${menuClassName}`} data-side={position.above ? 'top' : 'bottom'}
      style={{ left: position.left, width: position.width, maxHeight: position.maxHeight,
        top: position.top }}
      onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.preventDefault()}>
      {navigateGroups && group !== null && <li role="presentation" className="dropdown-group-back"><button type="button" onClick={() => { setGroup(null); setActive(0); trigger.current?.focus({ preventScroll: true }); }}><Icon name="chevron" />Semua provider</button><strong>{renderGroup?.(group) ?? group}</strong></li>}
      {choices.map((choice, index) => <li key={`${choice.value}-${index}`} role="presentation">
        {!navigateGroups && choice.group && choice.group !== choices[index - 1]?.group && <div className="dropdown-group-heading" role="presentation">{renderGroup?.(choice.group) ?? choice.group}</div>}
        <div id={optionId(index)} role="option"
        data-value={choice.value} aria-selected={index === selected} aria-disabled={choice.disabled || undefined}
        data-highlighted={index === activeIndex || undefined} title={choice.label}
        onPointerMove={() => { if (!choice.disabled) setActive(index); }} onClick={() => choose(index)}>
        <span>{groupStage ? renderGroup?.(choice.value) ?? choice.label : renderChoice?.(choice) ?? choice.label}</span>{!groupStage && index === selected && <Icon name="check" />}
      </div></li>)}
    </ul>, document.body)}
  </span>;
}
