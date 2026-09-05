import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import '@morefunos/ui/tokens.css';
import '@morefunos/ui/base.css';
import '@morefunos/ui/mobile-ordering.css';
import './smm.css';
import './option-acceptance-runtime.ts';
import {OrderingPage} from './OrderingPage.tsx';

const root=document.getElementById('root');
if(!root)throw new Error('SMM_ROOT_REQUIRED');
createRoot(root).render(<StrictMode>
  <main>
    <div className="smm-acceptance-banner" role="status">選項驗收模式 · 隔離資料 · 不會建立正式訂單</div>
    <OrderingPage/>
  </main>
</StrictMode>);
