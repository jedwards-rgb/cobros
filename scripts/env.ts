import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
if(existsSync('.env.local'))loadEnvFile('.env.local');
else if(existsSync('.env'))loadEnvFile('.env');
