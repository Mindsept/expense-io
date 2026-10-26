import { writeFileSync } from 'node:fs'
/** Exclusive creation never follows an existing symlink or overwrites a file. */
export function writeNewPrivateJson(file, value) {
  writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'})
}
