
import React, { useState, useRef, useEffect } from 'react';
import { Concept, PhotoboothSettings, AspectRatio, MonitorTheme } from '../types';
import { 
  uploadOverlayToGas, 
  uploadBackgroundToGas,
  uploadAudioToGas,
  saveSettingsToGas, 
  saveConceptsToGas
} from '../lib/appsScript';
import { getGoogleDriveDirectLink } from '../lib/imageUtils'; 
import { DEFAULT_GAS_URL } from '../constants';

interface AdminPageProps {
  settings: PhotoboothSettings;
  concepts: Concept[];
  onSaveSettings: (settings: PhotoboothSettings) => void;
  onSaveConcepts: (concepts: Concept[]) => void;
  onBack: () => void;
  onLaunchMonitor?: () => void;
}

const AdminPage: React.FC<AdminPageProps> = ({ settings, concepts, onSaveSettings, onSaveConcepts, onBack, onLaunchMonitor }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [localSettings, setLocalSettings] = useState(settings);
  const [localConcepts, setLocalConcepts] = useState(concepts);
  const [gasUrl, setGasUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'settings' | 'concepts'>('settings');
  const [isUploadingOverlay, setIsUploadingOverlay] = useState(false);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [isSavingConcepts, setIsSavingConcepts] = useState(false);

  const overlayInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedUrl = localStorage.getItem('APPS_SCRIPT_BASE_URL') || DEFAULT_GAS_URL;
    setGasUrl(savedUrl);
  }, []);

  useEffect(() => {
    setLocalConcepts(concepts);
  }, [concepts]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleLogin = () => {
    if (pin === settings.adminPin) {
      setIsAuthenticated(true);
    } else {
      alert('INVALID SECURITY PIN');
      setPin('');
    }
  };

  const handleSaveSettings = async () => {
    localStorage.setItem('APPS_SCRIPT_BASE_URL', gasUrl);
    // Jalankan onSaveSettings dulu (Simpan ke LocalStorage aplikasi)
    onSaveSettings(localSettings);
    
    const ok = await saveSettingsToGas(localSettings, settings.adminPin);
    if (ok) {
      alert('Settings saved locally and synced to Cloud.');
    } else {
      alert('Settings saved LOCALLY. Cloud sync failed, but data is safe on this machine.');
    }
  };

  const handleAddConcept = () => {
    const newId = `concept_${Date.now()}`;
    const newConcept: Concept = {
      id: newId,
      name: 'NEW CONCEPT',
      prompt: 'Describe transformation...',
      thumbnail: 'https://picsum.photos/seed/' + newId + '/300/500'
    };
    setLocalConcepts(prev => [...prev, newConcept]);
  };

  const handleDeleteConcept = (index: number) => {
    setLocalConcepts(prev => prev.filter((_, i) => i !== index));
  };

  const handleConceptChange = (index: number, field: keyof Concept, value: string) => {
    setLocalConcepts(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  };

  const handleThumbChange = (index: number, base64: string) => {
    setLocalConcepts(prev => prev.map((c, i) => i === index ? { ...c, thumbnail: base64 } : c));
  };

  const handleRefImageChange = (index: number, base64: string) => {
    setLocalConcepts(prev => prev.map((c, i) => i === index ? { ...c, refImage: base64 } : c));
  };

  const handleSyncConcepts = async () => {
    setIsSavingConcepts(true);
    try {
      // CRITICAL FIX: Simpan ke database lokal (IndexedDB) dulu!
      // Ini membuat item yang baru Anda tambahkan langsung tersimpan di mesin kiosk.
      onSaveConcepts(localConcepts);
      
      console.log("Saving concepts to cloud...");
      const ok = await saveConceptsToGas(localConcepts, settings.adminPin);
      
      if (ok) {
        alert('SUCCESS: Concepts saved locally AND synced to Cloud.');
      } else {
        alert('WARNING: Concepts saved LOCALLY only. Cloud sync failed (Data might be too large), but items are safe on this machine.');
      }
    } catch (e) {
        alert('Local save successful. Cloud error: ' + e);
    } finally {
      setIsSavingConcepts(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="w-full min-h-screen flex flex-col items-center justify-center p-6 bg-transparent">
        <h2 className="text-3xl font-heading mb-10 neon-text italic uppercase">SECURE ACCESS</h2>
        <div className="glass-card p-8 flex flex-col items-center gap-8 w-full max-w-sm backdrop-blur-md bg-black/60">
          <input type="password" placeholder="PIN" className="bg-black/50 border-2 border-white/5 px-6 py-5 text-center text-3xl outline-none focus:border-purple-500 w-full font-mono text-white rounded-lg" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
          <button onClick={handleLogin} className="w-full py-5 bg-purple-600 font-heading tracking-widest uppercase rounded-lg hover:bg-purple-500 transition-colors">AUTHORIZE</button>
          <button onClick={onBack} className="text-gray-400 hover:text-white uppercase text-[10px] tracking-widest transition-colors">Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen flex flex-col p-6 md:p-10 bg-transparent overflow-y-auto">
      <div className="flex flex-col md:flex-row justify-between items-center mb-10 max-w-7xl mx-auto w-full border-b border-white/5 pb-10 gap-8 bg-black/40 backdrop-blur-md p-6 rounded-xl">
        <h2 className="text-2xl font-heading text-white neon-text italic uppercase">SYSTEM_ROOT</h2>
        <div className="flex bg-white/5 p-1 rounded-xl">
          {(['settings', 'concepts'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-3 rounded-lg text-[10px] font-bold tracking-[0.3em] uppercase transition-all ${activeTab === tab ? 'bg-purple-600 text-white shadow-xl shadow-purple-900/40' : 'text-gray-500 hover:text-white'}`}>{tab}</button>
          ))}
        </div>
        <button onClick={() => setIsAuthenticated(false)} className="px-10 py-4 border-2 border-red-900/40 text-red-500 uppercase tracking-widest text-xs italic hover:bg-red-900/10 rounded-lg transition-colors">Disconnect</button>
      </div>

      <div className="max-w-7xl mx-auto w-full pb-24">
        <div className="flex justify-end mb-8">
           <button onClick={onLaunchMonitor} className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-900 to-purple-900 border border-blue-500/30 hover:border-blue-400 text-blue-200 font-heading tracking-[0.2em] uppercase rounded-lg shadow-lg hover:shadow-blue-500/20 transition-all backdrop-blur-md">
             <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
             LAUNCH LIVE MONITOR
           </button>
        </div>

        {activeTab === 'settings' && (
          <div className="flex flex-col gap-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
              <div className="glass-card p-6 md:p-10 flex flex-col gap-8 h-fit backdrop-blur-md bg-black/60 rounded-xl border border-white/10">
                <h3 className="font-heading text-xl text-purple-400 border-b border-white/5 pb-4 uppercase italic">Global Identity</h3>
                
                <div className="flex flex-col gap-3">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Event Name</label>
                  <input className="bg-black/50 border border-white/10 p-4 font-mono text-xs text-white focus:border-purple-500 outline-none transition-colors rounded-lg" value={localSettings.eventName} onChange={e => setLocalSettings({...localSettings, eventName: e.target.value})} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Booth Mode</label>
                        <select className="bg-black border border-white/10 p-3 text-xs rounded" value={localSettings.boothMode} onChange={e => setLocalSettings({...localSettings, boothMode: e.target.value as any})}>
                            <option value="photo">Photo Only</option>
                            <option value="video">Photo + Video</option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Video Res</label>
                        <select className="bg-black border border-white/10 p-3 text-xs rounded" value={localSettings.videoResolution} onChange={e => setLocalSettings({...localSettings, videoResolution: e.target.value as any})}>
                            <option value="480p">480p (Fast)</option>
                            <option value="720p">720p (HD)</option>
                        </select>
                    </div>
                </div>

                <div className="flex flex-col gap-3">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Video Prompt</label>
                  <textarea className="bg-black/50 border border-white/10 p-4 font-mono text-xs text-white h-24 rounded-lg" value={localSettings.videoPrompt} onChange={e => setLocalSettings({...localSettings, videoPrompt: e.target.value})} />
                </div>

                <button onClick={handleSaveSettings} className="w-full py-6 bg-green-800 hover:bg-green-700 text-white font-heading tracking-widest uppercase italic mt-6 rounded-lg shadow-xl">SAVE SETTINGS</button>
              </div>

              <div className="flex flex-col gap-8">
                 <div className="glass-card p-6 md:p-10 border-white/10 h-fit backdrop-blur-md bg-black/60 rounded-xl">
                    <h3 className="font-heading text-xl text-purple-400 border-b border-white/5 pb-4 uppercase italic">Apps Script URL</h3>
                    <input className="w-full bg-black/50 border border-white/10 p-4 font-mono text-[10px] text-blue-300 mt-4 rounded-lg" value={gasUrl} onChange={e => setGasUrl(e.target.value)} placeholder="https://script.google.com/..." />
                 </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'concepts' && (
          <div className="flex flex-col gap-10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {localConcepts.map((concept, index) => (
                <div key={concept.id} className="glass-card p-6 flex flex-col gap-4 relative group backdrop-blur-md bg-black/60 rounded-xl border border-white/10">
                  <button onClick={() => handleDeleteConcept(index)} className="absolute top-4 right-4 text-red-500 p-2 hover:bg-white/10 rounded">✕</button>
                  <div className="flex gap-4">
                     <div className="w-24 aspect-[9/16] bg-white/5 border border-white/10 rounded-xl shrink-0 overflow-hidden relative group/thumb">
                        <img src={concept.thumbnail} className="w-full h-full object-cover" />
                        <label className="absolute inset-0 bg-purple-600/80 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center cursor-pointer text-[10px] uppercase font-bold text-white text-center px-1">
                           Update Thumb
                           <input type="file" className="hidden" onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                 const reader = new FileReader();
                                 reader.onload = () => handleThumbChange(index, reader.result as string);
                                 reader.readAsDataURL(file);
                              }
                           }} />
                        </label>
                     </div>
                     <div className="flex-1 flex flex-col gap-4">
                        <input className="bg-transparent border-b border-white/10 p-2 font-heading uppercase italic text-white outline-none w-full" value={concept.name} onChange={e => handleConceptChange(index, 'name', e.target.value)} />
                        <textarea className="bg-black/30 border border-white/5 p-3 text-[10px] font-mono h-24 text-gray-400 resize-none w-full rounded-lg" value={concept.prompt} onChange={e => handleConceptChange(index, 'prompt', e.target.value)} />
                     </div>
                  </div>
                </div>
              ))}
              <button onClick={handleAddConcept} className="glass-card p-6 flex flex-col items-center justify-center gap-4 border-2 border-dashed border-white/10 hover:border-purple-500/50 hover:bg-white/5 transition-all min-h-[200px] rounded-xl">
                <div className="w-12 h-12 rounded-full border-2 border-white/20 flex items-center justify-center text-white/50">+</div>
                <span className="font-heading text-xs tracking-[0.3em] text-white/40 uppercase italic">ADD_NEW_CONCEPT</span>
              </button>
            </div>
            <div className="flex justify-center mt-10">
              <button onClick={handleSyncConcepts} disabled={isSavingConcepts} className="px-20 py-6 bg-purple-600 font-heading tracking-widest uppercase italic shadow-2xl hover:bg-purple-500 rounded-lg disabled:opacity-50">
                {isSavingConcepts ? 'SAVING...' : 'SYNC ALL CONCEPTS'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPage;
