import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Inspect the Git index, never local runtime files; report paths, not secret values.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const git=args=>execFileSync('git',args,{cwd:root,windowsHide:true,maxBuffer:16*1024*1024});
const files=git(['ls-files','-z']).toString().split('\0').filter(Boolean);
const allowedRoot=new Set(['.gitignore','.gitattributes','AGENTS.md','package.json','server.mjs','launcher.mjs','Start-Hookcut.cmd','Stop-Hookcut.cmd','README.md','QA.md','SECURITY.md','LICENSE']);
const allowedDirectory=/^(?:lib|public|tests|scripts|docs|\.github\/workflows|\.githooks)\//;
const sampleFiles=new Set(['samples/practice.mp4','samples/practice.srt','samples/speech-demo.mp4']);
const binaryFiles=new Set(['samples/practice.mp4','samples/speech-demo.mp4','docs/captioned-export.png']);
const sensitivePath=/(?:^|\/)(?:\.data|\.env(?:\..*)?|node_modules|credentials[^/]*|secrets[^/]*)(?:\/|$)|\.(?:pem|key|p12|pfx|sqlite|db|bin|log)$/i;
const secretPatterns=[
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /https?:\/\/[^\s/@]+:[^\s/@]+@/,
  /[A-Z]:[\\/]Users[\\/](?!Public[\\/])[^\s"'<>]+/i,
  /\b[A-Z0-9._%+-]+@(?:gmail|outlook|hotmail|yahoo)\.[A-Z]{2,}\b/i,
];
const failures=[];
for(const file of files){
  if(sensitivePath.test(file)||!(allowedRoot.has(file)||allowedDirectory.test(file)||sampleFiles.has(file))){failures.push(file+': not approved for publication');continue;}
  if(binaryFiles.has(file))continue;
  const content=git(['show',':'+file]);
  if(content.includes(0)){failures.push(file+': unexpected binary');continue;}
  if(secretPatterns.some(pattern=>pattern.test(content.toString('utf8'))))failures.push(file+': possible credential or personal information');
}
if(failures.length){console.error('Publication check failed:\n'+failures.join('\n'));process.exit(1);}
console.log(`Publication check passed for ${files.length} tracked files. Runtime data is excluded.`);
