import './env';
import { prepareReminders,dispatchReminders } from '../src/lib/reminders';
import { closeDB } from '../src/lib/db';
await prepareReminders();console.log(await dispatchReminders());await closeDB();
