import { ProfilePage } from '@/components/profile-page';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{history?:string}>}) {
 return <ProfilePage entity="student" id={(await params).id} history={(await searchParams).history}/>;
}
