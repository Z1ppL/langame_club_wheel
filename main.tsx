import React from 'react';
import {createRoot} from 'react-dom/client';
import Demo from './app/demo';
import './app/globals.css';
const page=location.pathname.replace(/^\//,'').replace(/\/$/,'');
createRoot(document.getElementById('root')!).render(<Demo page={(['session','wheel','topup','admin'].includes(page)?page:'session') as 'session'|'wheel'|'topup'|'admin'}/>);
