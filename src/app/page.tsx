import { requireActor } from '@/lib/auth';
import { getData } from '@/lib/collections';
import { Shell } from '@/components/shell';
import { Dashboard } from '@/components/dashboard';
export const dynamic='force-dynamic';
export default async function Home(){const actor=await requireActor();return <Shell actor={actor} section="dashboard"><Dashboard actor={actor} data={await getData(actor)}/></Shell>;}
