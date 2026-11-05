import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { BlenderComparison } from './BlenderComparison';
afterEach(()=>{cleanup();vi.restoreAllMocks();delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;});
it('shows observed differences and enlarges the actual reference without a false match score',()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:vi.fn(function(this:HTMLDialogElement){this.setAttribute('open','');})});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:vi.fn(function(this:HTMLDialogElement){this.removeAttribute('open');this.dispatchEvent(new Event('close'));})});
 const source='data:image/png;base64,source',rendered='data:image/png;base64,render';
 render(<BlenderComparison references={[{name:'Source.png',dataUrl:source}]} views={[{name:'view-front.png',dataUrl:rendered}]} review={{decision:'revise',differences:['Leher terlalu lebar'],unseen:['Sisi belakang tidak terlihat']}}/>);
 expect(screen.getByText('Leher terlalu lebar')).toBeTruthy();expect(screen.queryByText('100%')).toBeNull();
 expect(screen.getByRole('button',{name:'Perbesar view-front.png'})).toBeTruthy();
 fireEvent.click(screen.getByText('Referensi & pemeriksaan'));
 fireEvent.click(screen.getByRole('button',{name:'Perbesar Source.png'}));
 const dialog=screen.getByRole('dialog',{name:'Periksa detail referensi'});expect(dialog.querySelector('img')?.getAttribute('src')).toBe(source);
 fireEvent.change(screen.getByRole('slider',{name:'Zoom gambar'}),{target:{value:'200'}});expect(dialog.querySelector('img')?.style.width).toBe('200%');
 fireEvent.click(screen.getByRole('button',{name:'Tutup'}));expect(dialog.hasAttribute('open')).toBe(false);
});
