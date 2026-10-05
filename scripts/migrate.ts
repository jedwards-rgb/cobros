import './env';
import { migrate } from '../src/lib/schema';
import { closeDB } from '../src/lib/db';
await migrate();console.log('Esquema de CobroEdu preparado.');await closeDB();
