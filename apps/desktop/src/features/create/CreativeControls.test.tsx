import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CreativeControls } from './CreativeControls';
import type { useCreativeTask } from './useCreativeTask';
import type { ReferenceImage } from '../../services/references';
vi.mock('../shared/ObsidianContext',()=>({ObsidianContext:()=>null}));
vi.mock('../shared/ProviderPicker',()=>({ProviderPicker:()=>null}));
vi.mock('../shared/ModelControls',()=>({ModelControls:()=>null}));
vi.mock('../shared/OrcaUsagePanel',()=>({OrcaUsagePanel:()=>null}));
vi.mock('../shared/TaskRecovery',()=>({TaskRecovery:()=>null}));
vi.mock('../shared/TaskAttempts',()=>({TaskAttempts:()=>null}));
vi.mock('../../services/accountState',()=>({useDiscordAccount:()=>({account:{profile:null}})}));
vi.mock('../shared/ReferenceImages',()=>({ReferenceImages:({onChange}: {onChange:(r:ReferenceImage[])=>void})=><><button onClick={()=>onChange([{name:'shape.png',dataUrl:'data:image/png;base64,fixture'}])}>Upload test image</button><button onClick={()=>onChange([{name:'a.png',dataUrl:'data:image/png;base64,a'},{name:'b.png',dataUrl:'data:image/png;base64,b'}])}>Restore two images</button></>}));
const run=vi.fn();
function Composer({provider=true,busy=false}:{provider?:boolean;busy?:boolean}) {
 const [referenceImages,setReferenceImages]=useState<ReferenceImage[]>([]);
 const task={kind:'model3d',storageKey:'model3d:fixture',referenceImages,setReferenceImages,provider:provider?{id:'selected'}:null,modelSelection:{modelId:'selected-model'},run,busy,versions:[]} as unknown as ReturnType<typeof useCreativeTask>;
 return <CreativeControls task={task} initialPrompt=""/>;
}
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();});
it('requires only an image and ignores a saved text draft until the user selects prompt mode',()=>{
 localStorage.setItem('forgekit:prompt:model3d:fixture','Unrelated old model');render(<Composer/>);
 expect(screen.queryByLabelText('Apa yang ingin dibuat?')).toBeNull();
 expect(screen.getByRole('button',{name:'Buat 3D'})).toBeDisabled();
 fireEvent.click(screen.getByText('Upload test image'));
 expect(run).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Buat 3D'}));expect(run).toHaveBeenLastCalledWith('',null);
 fireEvent.click(screen.getByRole('button',{name:'Dengan prompt'}));
 expect(screen.getByLabelText('Apa yang ingin dibuat?')).toHaveValue('Unrelated old model');
 fireEvent.click(screen.getByRole('button',{name:'Generate'}));expect(run).toHaveBeenLastCalledWith('Unrelated old model',null);
 fireEvent.click(screen.getByRole('button',{name:'Dari gambar'}));expect(screen.queryByLabelText('Apa yang ingin dibuat?')).toBeNull();
});
it('still requires a selected account/model after an image is attached',()=>{
 render(<Composer provider={false}/>);fireEvent.click(screen.getByText('Upload test image'));
 expect(screen.getByRole('button',{name:'Buat 3D'})).toBeDisabled();
 expect(screen.getByText('Pilih akun dan model.')).toBeVisible();
});

it('keeps existing multi-image attachments but requires one image in the default mode',()=>{
 render(<Composer/>);fireEvent.click(screen.getByText('Restore two images'));
 expect(screen.getByRole('button',{name:'Buat 3D'})).toBeDisabled();expect(screen.getByText('Sisakan satu gambar atau gunakan Dengan prompt.')).toBeVisible();
 expect(run).not.toHaveBeenCalled();
});
