import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ReferenceImages } from './ReferenceImages';
import type { ReferenceImage } from '../../services/references';
vi.mock('../../services/references', () => ({ referenceAccept: 'image/*', referenceFormats: 'Gambar', readReference: vi.fn(async (file: File) => ({ name: file.name, dataUrl: 'data:image/png;base64,fixture' })) }));

function Composer() {
  const [images, setImages] = useState<ReferenceImage[]>([]);
  return <div className="chat-composer-input"><ReferenceImages compact value={images} onChange={setImages}><textarea aria-label="Input pesan chat" /></ReferenceImages></div>;
}
it('attaches beside the composer, previews and removes images without a separate disclosure panel', async () => {
  render(<Composer />);
  const button = screen.getByRole('button', { name: 'Lampirkan file referensi' });
  expect(button.closest('.chat-composer-input')).toContainElement(screen.getByLabelText('Input pesan chat'));
  const input = screen.getByLabelText('Pilih file referensi');
  expect(input).not.toBeVisible();
  fireEvent.change(input, { target: { files: [new File(['image'], 'scythe.png', { type: 'image/png' })] } });
  expect(await screen.findByAltText('Referensi scythe.png')).toBeVisible();
  expect(button).toHaveTextContent('1');
  expect(screen.getByText('Isi hasil pemrosesan dikirim bersama pesan ke akun AI pilihan.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus referensi scythe.png' }));
  expect(screen.queryByAltText('Referensi scythe.png')).toBeNull();
});
it('keeps the three-image limit and reports overflow beside the composer', async () => {
  render(<Composer />);
  fireEvent.change(screen.getByLabelText('Pilih file referensi'), { target: { files: [1,2,3,4].map(i => new File(['x'], `${i}.png`, { type: 'image/png' })) } });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Maksimal 3 lampiran referensi.'));
  expect(screen.queryByRole('img')).toBeNull();
});

it('image-only mode filters the picker and rejects non-image drops before extraction',async()=>{
 render(<ReferenceImages imagesOnly value={[]} onChange={vi.fn()}/>);
 expect(screen.getByLabelText('Pilih file referensi')).toHaveAttribute('accept','.png,.jpg,.jpeg,.webp');
 fireEvent.change(screen.getByLabelText('Pilih file referensi'),{target:{files:[new File(['document'],'source.pdf',{type:'application/pdf'})]}});
 expect(await screen.findByRole('alert')).toHaveTextContent('Pilih gambar PNG, JPG atau WebP');
 expect(screen.queryByRole('img')).toBeNull();
});

it('single-image mode rejects multiple files without discarding an existing image', async()=>{
 const onChange=vi.fn();render(<ReferenceImages imagesOnly maxFiles={1} value={[]} onChange={onChange}/>);
 const picker=screen.getByLabelText('Pilih file referensi');expect(picker).not.toHaveAttribute('multiple');
 fireEvent.change(picker,{target:{files:[new File(['a'],'a.png',{type:'image/png'}),new File(['b'],'b.png',{type:'image/png'})]}});
 expect(await screen.findByRole('alert')).toHaveTextContent('Gunakan satu gambar');expect(onChange).not.toHaveBeenCalled();
});
