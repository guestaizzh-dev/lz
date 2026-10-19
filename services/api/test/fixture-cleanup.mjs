// Remove only IDs owned by each test, in the same order as the real foreign keys.
export async function clearArticles(db, ids) {
  await db.note.deleteMany({where:{articleId:{in:ids}}});
  await db.favorite.deleteMany({where:{articleId:{in:ids}}});
  await db.reaction.deleteMany({where:{resourceId:{in:ids}}});
  await db.report.deleteMany({where:{resourceId:{in:ids}}});
  await db.comment.deleteMany({where:{resourceId:{in:ids}}});
  await db.readingEvent.deleteMany({where:{resourceId:{in:ids}}});
  await db.resourceEvidence.deleteMany({where:{resourceId:{in:ids}}});
  await db.contentRelation.deleteMany({where:{OR:[{fromId:{in:ids}},{toId:{in:ids}}]}});
  const releases=await db.articleRelease.findMany({where:{articleId:{in:ids}},select:{id:true}});
  await db.article.updateMany({where:{id:{in:ids}},data:{currentReleaseId:null}});
  await db.articleBlock.deleteMany({where:{releaseId:{in:releases.map(r=>r.id)}}});
  await db.articleRelease.deleteMany({where:{id:{in:releases.map(r=>r.id)}}});
}
export async function clearCourses(db, ids) {
  await db.courseVersionChoice.deleteMany({where:{courseId:{in:ids}}});
  await db.cohortCertificate.deleteMany({where:{courseId:{in:ids}}});
  const registrations=await db.cohortRegistration.findMany({where:{courseId:{in:ids}},select:{id:true}});
  const registrationIds=registrations.map(r=>r.id);
  await db.studyEvent.deleteMany({where:{cohortRegistrationId:{in:registrationIds}}});
  await db.cohortStudyProgress.deleteMany({where:{registrationId:{in:registrationIds}}});
  await db.cohortRegistration.deleteMany({where:{id:{in:registrationIds}}});
  await db.courseCertificate.deleteMany({where:{courseId:{in:ids}}});
  await db.courseReview.deleteMany({where:{courseId:{in:ids}}});
  await db.growthLedger.deleteMany({where:{sourceResourceId:{in:ids}}});
  const tasks=await db.practiceTask.findMany({where:{courseId:{in:ids}},select:{id:true}});
  const checkins=await db.practiceCheckin.findMany({where:{taskId:{in:tasks.map(t=>t.id)}},select:{id:true}});
  await db.teacherReview.deleteMany({where:{checkinId:{in:checkins.map(c=>c.id)}}});
  await db.attachmentBinding.deleteMany({where:{checkinId:{in:checkins.map(c=>c.id)}}});
  await db.practiceCheckin.deleteMany({where:{taskId:{in:tasks.map(t=>t.id)}}});
  await db.practiceTask.deleteMany({where:{id:{in:tasks.map(t=>t.id)}}});
  await db.enrollment.deleteMany({where:{courseId:{in:ids}}});
  const assignments=await db.assignment.findMany({where:{courseId:{in:ids}},select:{id:true}});
  const submissions=await db.submission.findMany({where:{assignmentId:{in:assignments.map(a=>a.id)}},select:{id:true}});
  const submissionIds=submissions.map(s=>s.id);
  await db.teacherReview.deleteMany({where:{submissionId:{in:submissionIds}}});
  await db.attachmentBinding.deleteMany({where:{submissionId:{in:submissionIds}}});
  await db.submission.deleteMany({where:{id:{in:submissionIds}}});
  await db.assignment.deleteMany({where:{id:{in:assignments.map(a=>a.id)}}});
  await db.courseStaff.deleteMany({where:{courseId:{in:ids}}});
  await db.notification.deleteMany({where:{resourceId:{in:ids}}});
  const releases=await db.courseRelease.findMany({where:{courseId:{in:ids}},select:{id:true}});
  const releaseIds=releases.map(r=>r.id), lessons=await db.lesson.findMany({where:{releaseId:{in:releaseIds}},select:{id:true}});
  await db.channelProductMapping.deleteMany({where:{offerId:{in:(await db.saleOffer.findMany({where:{courseReleaseId:{in:releaseIds}},select:{id:true}})).map(o=>o.id)}}});
  await db.saleOffer.deleteMany({where:{kind:'COURSE',courseReleaseId:{in:releaseIds}}});
  const lessonIds=lessons.map(r=>r.id);
  await db.studyEvent.deleteMany({where:{lessonId:{in:lessonIds}}});
  await db.studyProgress.deleteMany({where:{lessonId:{in:lessonIds}}});
  await db.course.updateMany({where:{id:{in:ids}},data:{publishedReleaseId:null}});
  await db.lesson.deleteMany({where:{id:{in:lessonIds}}});
  await db.courseRelease.deleteMany({where:{id:{in:releaseIds}}});
  await db.courseChapter.deleteMany({where:{courseId:{in:ids}}});
}
export async function clearProducts(db, ids) {
  const skus=await db.productSku.findMany({where:{productId:{in:ids}},select:{id:true}});
  const skuIds=skus.map(s=>s.id);
  await db.cartItem.deleteMany({where:{skuId:{in:skuIds}}});
  await db.saleOffer.deleteMany({where:{skuId:{in:skuIds}}});
  await db.inventoryLedger.deleteMany({where:{skuId:{in:skuIds}}});
  await db.productSku.deleteMany({where:{id:{in:skuIds}}});
}
export async function clearPlans(db, ids) {
  await db.membershipPlan.updateMany({where:{id:{in:ids}},data:{currentVersionId:null}});
  const versions=(await db.membershipPlanVersion.findMany({where:{planId:{in:ids}},select:{id:true}})).map(v=>v.id);
  await db.benefitScope.deleteMany({where:{planBenefitId:{in:(await db.planBenefit.findMany({where:{planVersionId:{in:versions}},select:{id:true}})).map(b=>b.id)}}});
  await db.planBenefit.deleteMany({where:{planVersionId:{in:(await db.membershipPlanVersion.findMany({where:{planId:{in:ids}},select:{id:true}})).map(v=>v.id)}}});
  await db.membershipPlanVersion.deleteMany({where:{planId:{in:ids}}});
}
