import { tt, ttf } from './i18n';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { SearchOverlay } from './components/SearchOverlay';
import { IconSprite } from './components/Icons';
import Home from './screens/Home';

const TaskDetail = lazy(() => import('./screens/TaskDetail'));
const Digest = lazy(() => import('./screens/Digest'));
const Board = lazy(() => import('./screens/Board'));
const Timeline = lazy(() => import('./screens/Timeline'));
const Ontology = lazy(() => import('./screens/Ontology'));
const Review = lazy(() => import('./screens/Review'));
const Week = lazy(() => import('./screens/Week'));
const Devices = lazy(() => import('./screens/Devices'));
const Conversation = lazy(() => import('./screens/Conversation'));

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen((o) => !o); }
      else if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setSearchOpen(false); }, [loc.pathname]);
  return (
    <>
      <IconSprite />
      <TopBar onSearch={() => setSearchOpen(true)} />
      <Suspense fallback={<div className="state" style={{ position: 'absolute', inset: '52px 0 0' }}>{tt("불러오는 중…")}</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tasks/:taskId" element={<TaskDetail />} />
          <Route path="/conversations/:conversationId" element={<Conversation />} />
          <Route path="/digest" element={<Digest />} />
          <Route path="/digest/:date" element={<Digest />} />
          <Route path="/board" element={<Board />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/ontology" element={<Ontology />} />
          <Route path="/review" element={<Review />} />
          <Route path="/week" element={<Week />} />
          <Route path="/week/:date" element={<Week />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="*" element={<div className="state" style={{ position: 'absolute', inset: '52px 0 0' }}><b>{tt("없는 화면이에요")}</b></div>} />
        </Routes>
      </Suspense>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
