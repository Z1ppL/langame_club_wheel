import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
export default defineConfig({
 root:fileURLToPath(new URL('.',import.meta.url)),
 resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
 plugins:[react(),{name:'record-bundle-modules',generateBundle(_,bundle){const files=new Set<string>();for(const b of Object.values(bundle)){if(b.type==='chunk')for(const m of Object.keys(b.modules))files.add(m)}writeFileSync('.bundle-modules.json',JSON.stringify([...files]));}}],
 css:{postcss:{plugins:[tailwind()]}},
 build:{outDir:'../public',emptyOutDir:true,target:'es2022',sourcemap:false,chunkSizeWarningLimit:1000}
});
