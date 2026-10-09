// Remove only IDs owned by each test, in the same order as the real foreign keys.
export async function clearArticles(db, ids) {
  await db.note.deleteMany({where:{articleId:{in:ids}}});
  await db.favorite.deleteMany({where:{articleId:{in:ids}}});
  await db.reaction.deleteMany({where:{resourceId:{in:ids}}});
}
export async function clearCourses(db, ids) {
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
  await db.productSku.deleteMany({where:{id:{in:skuIds}}});
}
export async function clearPlans(db, ids) {
  await db.membershipPlan.updateMany({where:{id:{in:ids}},data:{currentVersionId:null}});
  await db.membershipPlanVersion.deleteMany({where:{planId:{in:ids}}});
}
